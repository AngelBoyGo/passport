import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    artisanalBuyingStation: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    oreIntakeReceipt: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    agentWallet: { upsert: vi.fn() },
    commodityReserve: { upsert: vi.fn() },
    vaultBatch: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  calculateArtisanalPayout,
  processOreIntake,
  bridgeDoréToRefinedVault,
  getArtisanalMetrics,
} from "../artisanal-sourcing";
import * as oracle from "../commodity-oracle";
import type { CommodityPrice } from "../commodity-oracle";
import * as porService from "../por-service";

describe("Sovereign Artisanal Sourcing & Doré Refinery Bridge", () => {
  const miner = "a".repeat(64);
  const stationCode = "STN-ML-KENIEBA-01";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("calculateArtisanalPayout (Pure Invariant Math)", () => {
    it("computes 95% spot payout at canonical $5.00/ANGEL rate", () => {
      // 100g ore at 90% Au (90g fine Au) with gold spot at $75.00/g
      // fineGrams = 90.0g
      // payoutUsd = 90.0 * $75.00 * 0.95 = $6,412.50
      // payoutAngel = Math.floor(6412.50 / 5.0) = 1,282 ANGEL
      const payout = calculateArtisanalPayout(100.0, 0.90, 75.0, 95.0);

      expect(payout.grossGrams).toBe(100.0);
      expect(payout.fineness).toBe(0.90);
      expect(payout.fineGrams).toBe(90.0);
      expect(payout.spotPriceUsd).toBe(75.0);
      expect(payout.payoutUsd).toBe(6412.5);
      expect(payout.payoutAngel).toBe(1282);
    });

    it("rejects non-positive weights, invalid fineness, or zero spot price", () => {
      expect(() => calculateArtisanalPayout(-10, 0.85, 75.0)).toThrow(/grossGrams/);
      expect(() => calculateArtisanalPayout(50, 0.40, 75.0)).toThrow(/fineness/);
      expect(() => calculateArtisanalPayout(50, 1.20, 75.0)).toThrow(/fineness/);
      expect(() => calculateArtisanalPayout(50, 0.85, 0)).toThrow(/spotPriceUsd/);
    });
  });

  describe("processOreIntake", () => {
    it("records verified ore intake and credits miner's wallet", async () => {
      vi.spyOn(oracle, "getCommoditySpotPrices").mockReturnValue({
        Au: {
          symbol: "Au",
          commodityType: "GOLD",
          name: "Fine Physical Gold",
          unit: "gram",
          priceUsd: 75.0,
          change24hPercent: 0.5,
          volatility30dPercent: 4.0,
          lastUpdated: new Date().toISOString(),
          isStale: false,
          source: "AES",
        },
      } as unknown as Record<string, CommodityPrice>);

      prismaMock.artisanalBuyingStation.findUnique.mockResolvedValue({
        id: "stn_kenieba_01",
        stationCode,
        stationPublicKey: "pk_xrf_mock",
        activeStatus: "ACTIVE",
      });
      prismaMock.agentWallet.upsert.mockResolvedValue({});
      prismaMock.oreIntakeReceipt.create.mockResolvedValue({
        receiptNumber: "ORE-001",
        stationCode,
        minerCommitment: miner,
        grossWeightGrams: 50.0,
        assayedFineness: 0.88,
        fineGoldGrams: 44.0,
        payoutUsd: 3135.0,
        payoutAngel: 627,
        status: "PURCHASED",
        createdAt: new Date(),
      });
      prismaMock.artisanalBuyingStation.update.mockResolvedValue({});

      const result = await processOreIntake({
        receiptNumber: "ORE-001",
        stationCode,
        minerCommitment: miner,
        grossWeightGrams: 50.0,
        assayedFineness: 0.88,
        spectrometerSignature: "sig_xrf",
      });

      expect(result.receipt.status).toBe("PURCHASED");
      expect(result.payout.payoutAngel).toBe(627);
      expect(prismaMock.agentWallet.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { subjectCommitment: miner },
          create: expect.objectContaining({ balance: 627 }),
        })
      );
    });

    it("refuses intake when the commodity oracle is stale", async () => {
      vi.spyOn(oracle, "getCommoditySpotPrices").mockReturnValue({
        Au: {
          symbol: "Au",
          commodityType: "GOLD",
          name: "Fine Physical Gold",
          unit: "gram",
          priceUsd: 75.0,
          change24hPercent: 0,
          volatility30dPercent: 4.0,
          lastUpdated: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
          isStale: true,
          source: "AES",
        },
      } as unknown as Record<string, CommodityPrice>);

      await expect(
        processOreIntake({
          receiptNumber: "ORE-STALE",
          stationCode,
          minerCommitment: miner,
          grossWeightGrams: 50.0,
          assayedFineness: 0.88,
          spectrometerSignature: "sig",
        })
      ).rejects.toThrow(/stale/);
    });

    it("refuses intake when buying station is not active", async () => {
      vi.spyOn(oracle, "getCommoditySpotPrices").mockReturnValue({
        Au: { symbol: "Au", isStale: false, priceUsd: 75.0 },
      } as unknown as Record<string, CommodityPrice>);

      prismaMock.artisanalBuyingStation.findUnique.mockResolvedValue({
        id: "stn_suspended",
        stationCode: "STN-SUSPENDED",
        activeStatus: "QUARANTINED",
      });

      await expect(
        processOreIntake({
          receiptNumber: "ORE-SUSP",
          stationCode: "STN-SUSPENDED",
          minerCommitment: miner,
          grossWeightGrams: 50.0,
          assayedFineness: 0.88,
          spectrometerSignature: "sig",
        })
      ).rejects.toThrow(/QUARANTINED/);
    });

    it("rejects intake if computed payout is below minimum 1 ANGEL ($5.00 USD)", async () => {
      vi.spyOn(oracle, "getCommoditySpotPrices").mockReturnValue({
        Au: { symbol: "Au", isStale: false, priceUsd: 75.0 },
      } as unknown as Record<string, CommodityPrice>);

      prismaMock.artisanalBuyingStation.findUnique.mockResolvedValue({
        id: "stn_kenieba",
        stationCode,
        activeStatus: "ACTIVE",
      });

      // 0.05g at 70% Au = 0.035g * $75 * 0.95 = $2.49 USD -> 0 ANGEL
      await expect(
        processOreIntake({
          receiptNumber: "ORE-TINY",
          stationCode,
          minerCommitment: miner,
          grossWeightGrams: 0.05,
          assayedFineness: 0.70,
          spectrometerSignature: "sig",
        })
      ).rejects.toThrow(/below the minimum settlement threshold/);
    });
  });

  describe("bridgeDoréToRefinedVault (Refinery Boundary & PoR Update)", () => {
    it("refuses bridge if refined bullion purity is below 99.50% standard", async () => {
      await expect(
        bridgeDoréToRefinedVault({
          receiptNumbers: ["ORE-1"],
          targetBatchNumber: "BATCH-FAIL",
          vaultId: "VAULT-BKO",
          custodianName: "SOREM",
          locationCity: "Bamako",
          locationCountry: "ML",
          barSerials: ["B1"],
          refinedGrossGrams: 100.0,
          refinedFineness: 0.9850, // 98.50% < 99.50%
        })
      ).rejects.toThrow(/99.50%/);
    });

    it("bridges raw doré receipts into an investment-grade VaultBatch and updates Merkle root", async () => {
      prismaMock.oreIntakeReceipt.findMany.mockResolvedValue([
        { receiptNumber: "ORE-1", status: "PURCHASED", fineGoldGrams: 50.0 },
        { receiptNumber: "ORE-2", status: "PURCHASED", fineGoldGrams: 50.0 },
      ]);
      prismaMock.oreIntakeReceipt.updateMany.mockResolvedValue({ count: 2 });
      prismaMock.commodityReserve.upsert.mockResolvedValue({ id: "res_au" });
      prismaMock.vaultBatch.create.mockResolvedValue({
        batchNumber: "BKO-AU-2026-REFINED-01",
        vaultId: "VAULT-BKO-CENTRAL",
        custodianName: "Banque Nationale / SOREM",
        grossWeightGrams: 100.0,
        fineness: 0.9999,
        fineWeightGrams: 99.99,
        status: "AUDITED",
      });

      vi.spyOn(porService, "generateLivePoR").mockResolvedValue({
        reserve: { merkleRoot: "merkle_root_updated_123" },
      } as unknown as Awaited<ReturnType<typeof porService.generateLivePoR>>);

      const result = await bridgeDoréToRefinedVault({
        receiptNumbers: ["ORE-1", "ORE-2"],
        targetBatchNumber: "BKO-AU-2026-REFINED-01",
        vaultId: "VAULT-BKO-CENTRAL",
        custodianName: "Banque Nationale / SOREM",
        locationCity: "Bamako",
        locationCountry: "ML",
        barSerials: ["ML-2026-REF-01"],
        refinedGrossGrams: 100.0,
        refinedFineness: 0.9999,
      });

      expect(result.receiptsRefinedCount).toBe(2);
      expect(result.totalRawFineGrams).toBe(100.0);
      expect(result.newReserveMerkleRoot).toBe("merkle_root_updated_123");
      expect(prismaMock.oreIntakeReceipt.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "REFINED_SETTLED" }),
        })
      );
    });
  });

  describe("getArtisanalMetrics", () => {
    it("aggregates station and ore intake statistics", async () => {
      prismaMock.artisanalBuyingStation.findMany.mockResolvedValue([
        { id: "s1", activeStatus: "ACTIVE" },
        { id: "s2", activeStatus: "ACTIVE" },
      ]);
      prismaMock.oreIntakeReceipt.findMany.mockResolvedValue([
        { grossWeightGrams: 100, fineGoldGrams: 90, payoutAngel: 1282, status: "REFINED_SETTLED" },
        { grossWeightGrams: 50, fineGoldGrams: 45, payoutAngel: 641, status: "PURCHASED" },
      ]);

      const metrics = await getArtisanalMetrics();

      expect(metrics.totalBuyingStations).toBe(2);
      expect(metrics.activeStations).toBe(2);
      expect(metrics.totalIntakeReceipts).toBe(2);
      expect(metrics.totalGrossGramsFormalized).toBe(150);
      expect(metrics.totalFineGramsFormalized).toBe(135);
      expect(metrics.totalAngelPaidToMiners).toBe(1923);
      expect(metrics.receiptsRefinedToBullion).toBe(1);
      expect(metrics.receiptsInTransit).toBe(1);
    });
  });
});
