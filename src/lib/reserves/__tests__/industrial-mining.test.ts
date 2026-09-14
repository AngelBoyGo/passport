import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    industrialMiningConcession: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    smeltingRunTelemetry: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    agentWallet: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    commodityReserve: { upsert: vi.fn(), findMany: vi.fn() },
    vaultBatch: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  calculateIndustrialRoyalty,
  recordSmeltingRun,
  bridgeIndustrialDoréToRefinery,
  getIndustrialMiningMetrics,
} from "../industrial-mining";
import * as oracle from "../commodity-oracle";
import type { CommodityPrice } from "../commodity-oracle";
import * as porService from "../por-service";

describe("Industrial Mining Telemetry & Anti-Transfer-Pricing Royalty Engine", () => {
  const concessionCode = "CONC-ML-FEKOLA";
  const hsmPublicKey = "pk_hsm_furnace";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("calculateIndustrialRoyalty (Pure Invariant Math)", () => {
    it("computes royalty and state equity evaluated at neutral spot index", () => {
      const calc = calculateIndustrialRoyalty({
        grossGrams: 5000,
        densityGramsPerCc: 17.5,
        auFineness: 0.88,
        agFineness: 0.08,
        goldSpotUsdPerGram: 75.0,
        silverSpotUsdPerGram: 0.95,
        statutoryRoyaltyPercent: 10.0,
        stateParticipationPercent: 20.0,
      });

      // fineGold = 5000 * 0.88 = 4400 g; fineSilver = 5000 * 0.08 = 400 g
      expect(calc.fineGoldGrams).toBe(4400.0);
      expect(calc.fineSilverGrams).toBe(400.0);
      expect(calc.grossMarketValueUsd).toBeCloseTo(330380.0);

      // Royalty (10%): 33,038 USD -> 6,607 ANGEL
      expect(calc.royaltyDueAngel).toBe(6607);
      // State equity (20%): 66,076 USD -> 13,215 ANGEL
      expect(calc.stateShareDueAngel).toBe(13215);
      expect(calc.totalStateCaptureAngel).toBe(19822);
    });

    it("rejects physically impossible specific gravity density", () => {
      expect(() =>
        calculateIndustrialRoyalty({
          grossGrams: 5000,
          densityGramsPerCc: 4.2, // Tungsten false reading
          auFineness: 0.88,
          goldSpotUsdPerGram: 75.0,
        })
      ).toThrow(/Specific gravity density/);
    });

    it("rejects gold fineness outside metallurgical bounds", () => {
      expect(() =>
        calculateIndustrialRoyalty({
          grossGrams: 5000,
          densityGramsPerCc: 17.5,
          auFineness: 1.20, // Impossible > 100% gold
          goldSpotUsdPerGram: 75.0,
        })
      ).toThrow(/gold fineness/);
    });
  });

  describe("recordSmeltingRun", () => {
    it("records furnace telemetry and credits royalty into treasury", async () => {
      vi.spyOn(oracle, "getCommoditySpotPrices").mockReturnValue({
        Au: { symbol: "Au", priceUsd: 75.0, isStale: false },
      } as unknown as Record<string, CommodityPrice>);

      prismaMock.industrialMiningConcession.findUnique.mockResolvedValue({
        id: "conc_1",
        concessionCode,
        activeStatus: "ACTIVE",
        statutoryRoyaltyPercent: 10.0,
        stateParticipationPercent: 20.0,
        smelterHsmPublicKey: hsmPublicKey,
      });
      prismaMock.smeltingRunTelemetry.create.mockResolvedValue({
        runNumber: "SMELT-001",
        concessionCode,
        grossPouredGrams: 5000.0,
        fineGoldGrams: 4400.0,
        grossMarketValueUsd: 330380.0,
        royaltyDueAngel: 6607,
        stateShareDueAngel: 13215,
        status: "POURED",
        pouredAt: new Date(),
      });
      prismaMock.industrialMiningConcession.update.mockResolvedValue({});
      prismaMock.agentWallet.upsert.mockResolvedValue({});

      const result = await recordSmeltingRun({
        runNumber: "SMELT-001",
        concessionCode,
        grossPouredGrams: 5000.0,
        densityGramsPerCc: 17.5,
        estimatedAuFineness: 0.88,
        hsmSignature: "sig_hsm",
        hsmPublicKey,
      });

      expect(result.run.status).toBe("POURED");
      expect(result.calculation.totalStateCaptureAngel).toBe(19822);
      // Royalty credited to national stabilization treasury
      expect(prismaMock.agentWallet.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { subjectCommitment: "protocol_treasury_system" },
          update: expect.objectContaining({ balance: { increment: 19822 } }),
        })
      );
    });

    it("ignores a caller-supplied hsmPublicKey and rejects a forged production signature", async () => {
      vi.stubEnv("NODE_ENV", "production");
      try {
        vi.spyOn(oracle, "getCommoditySpotPrices").mockReturnValue({
          Au: { symbol: "Au", priceUsd: 75.0, isStale: false },
        } as unknown as Record<string, CommodityPrice>);

        prismaMock.industrialMiningConcession.findUnique.mockResolvedValue({
          id: "conc_1",
          concessionCode,
          activeStatus: "ACTIVE",
          statutoryRoyaltyPercent: 10.0,
          stateParticipationPercent: 20.0,
          smelterHsmPublicKey: "bb".repeat(32),
        });

        await expect(
          recordSmeltingRun({
            runNumber: "SMELT-FORGED",
            concessionCode,
            grossPouredGrams: 5000.0,
            densityGramsPerCc: 17.5,
            estimatedAuFineness: 0.88,
            hsmSignature: "00".repeat(64),
            hsmPublicKey: "cc".repeat(32), // attacker key must be ignored
          })
        ).rejects.toThrow(/Invalid furnace edge HSM/);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("refuses intake if gold spot oracle is stale", async () => {
      vi.spyOn(oracle, "getCommoditySpotPrices").mockReturnValue({
        Au: { symbol: "Au", priceUsd: 75.0, isStale: true },
      } as unknown as Record<string, CommodityPrice>);

      await expect(
        recordSmeltingRun({
          runNumber: "SMELT-STALE",
          concessionCode,
          grossPouredGrams: 1000.0,
          densityGramsPerCc: 17.5,
          estimatedAuFineness: 0.88,
          hsmSignature: "sig",
        })
      ).rejects.toThrow(/stale/);
    });
  });

  describe("bridgeIndustrialDoréToRefinery", () => {
    it("bridges poured smelting runs into an investment-grade VaultBatch and updates Merkle root", async () => {
      prismaMock.smeltingRunTelemetry.findMany.mockResolvedValue([
        { runNumber: "SMELT-001", status: "POURED", fineGoldGrams: 4400.0 },
        { runNumber: "SMELT-002", status: "POURED", fineGoldGrams: 4400.0 },
      ]);
      prismaMock.smeltingRunTelemetry.updateMany.mockResolvedValue({ count: 2 });
      prismaMock.commodityReserve.upsert.mockResolvedValue({ id: "res_au" });
      prismaMock.vaultBatch.create.mockResolvedValue({
        batchNumber: "BKO-AU-2026-IND-01",
        vaultId: "VAULT-BKO-CENTRAL",
        custodianName: "SOREM Industrial Refinery",
        grossWeightGrams: 8800.0,
        fineness: 0.9999,
        fineWeightGrams: 8799.0,
        status: "AUDITED",
      });

      vi.spyOn(porService, "generateLivePoR").mockResolvedValue({
        reserve: { merkleRoot: "merkle_industrial_updated_123" },
      } as unknown as Awaited<ReturnType<typeof porService.generateLivePoR>>);

      const result = await bridgeIndustrialDoréToRefinery({
        runNumbers: ["SMELT-001", "SMELT-002"],
        targetBatchNumber: "BKO-AU-2026-IND-01",
        vaultId: "VAULT-BKO-CENTRAL",
        custodianName: "SOREM Industrial Refinery",
        locationCity: "Bamako",
        locationCountry: "ML",
        barSerials: ["ML-IND-REF-01"],
        refinedGrossGrams: 8800.0,
        refinedFineness: 0.9999,
      });

      expect(result.runsRefinedCount).toBe(2);
      expect(result.newReserveMerkleRoot).toBe("merkle_industrial_updated_123");
      expect(prismaMock.smeltingRunTelemetry.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "REFINED_SETTLED" }),
        })
      );
    });
  });

  describe("getIndustrialMiningMetrics", () => {
    it("aggregates industrial extraction and royalty metrics", async () => {
      prismaMock.industrialMiningConcession.findMany.mockResolvedValue([
        { concessionCode: "CONC-ML-FEKOLA", activeStatus: "ACTIVE" },
      ]);
      prismaMock.smeltingRunTelemetry.findMany.mockResolvedValue([
        { grossPouredGrams: 5000, fineGoldGrams: 4400, grossMarketValueUsd: 330380, royaltyDueAngel: 6607, stateShareDueAngel: 13215, status: "POURED" },
        { grossPouredGrams: 4000, fineGoldGrams: 3520, grossMarketValueUsd: 264304, royaltyDueAngel: 5286, stateShareDueAngel: 10571, status: "REFINED_SETTLED" },
      ]);

      const metrics = await getIndustrialMiningMetrics();
      expect(metrics.activeConcessionsCount).toBe(1);
      expect(metrics.totalGrossPouredGrams).toBe(9000);
      expect(metrics.totalFineGoldGrams).toBe(7920);
      expect(metrics.totalRoyaltiesCapturedAngel).toBe(11893);
      expect(metrics.totalStateEquityAngel).toBe(23786);
      expect(metrics.runsRefinedToBullion).toBe(1);
    });
  });
});