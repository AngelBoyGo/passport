import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    coastalPortEnclave: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    vaultBatch: { findUnique: vi.fn(), update: vi.fn() },
    agentWallet: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    bondedTransitWaybill: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  dispatchDiplomaticTransit,
  recordIntermediateCheckpoint,
  recordPortArrival,
  reportSealBreach,
  getTransitMetrics,
} from "../bonded-transit";
import * as porService from "../por-service";
import * as oracle from "../commodity-oracle";
import type { CommodityPrice } from "../commodity-oracle";

describe("Cross-Border Diplomatic Bonded Customs & Coastal Logistics", () => {
  const carrier = "c".repeat(64);
  const sealDigest = "d".repeat(64);
  const batchNumber = "BKO-AU-2026-CONVOY";
  const portCode = "PORT-LOME-TG";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("dispatchDiplomaticTransit", () => {
    it("locks carrier bond, dispatches waybill, and transitions batch to IN_TRANSIT", async () => {
      prismaMock.coastalPortEnclave.findUnique.mockResolvedValue({
        id: "enclave_lome",
        portCode,
        activeStatus: "ACTIVE",
      });
      prismaMock.vaultBatch.findUnique.mockResolvedValue({
        batchNumber,
        status: "AUDITED",
        grossWeightGrams: 500.0,
        fineWeightGrams: 499.5,
      });
      prismaMock.agentWallet.findUnique.mockResolvedValue({
        subjectCommitment: carrier,
        balance: 10000,
        staked: 0,
      });
      prismaMock.agentWallet.update.mockResolvedValue({});
      prismaMock.vaultBatch.update.mockResolvedValue({});
      prismaMock.bondedTransitWaybill.create.mockResolvedValue({
        waybillNumber: "WAYBILL-001",
        batchNumber,
        destinationPortCode: portCode,
        carrierCommitment: carrier,
        carrierBondAngel: 5000,
        status: "DISPATCHED",
      });

      const waybill = await dispatchDiplomaticTransit({
        waybillNumber: "WAYBILL-001",
        batchNumber,
        destinationPortCode: portCode,
        originVaultId: "VAULT-BKO",
        carrierCommitment: carrier,
        carrierBondAngel: 5000,
        diplomaticSealDigest: sealDigest,
      });

      expect(waybill.status).toBe("DISPATCHED");
      expect(prismaMock.agentWallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { subjectCommitment: carrier },
          data: expect.objectContaining({ staked: { increment: 5000 } }),
        })
      );
      expect(prismaMock.vaultBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { batchNumber },
          data: { status: "IN_TRANSIT" },
        })
      );
    });

    it("rejects dispatch if carrier has insufficient available collateral for performance bond", async () => {
      prismaMock.coastalPortEnclave.findUnique.mockResolvedValue({
        portCode,
        activeStatus: "ACTIVE",
      });
      prismaMock.vaultBatch.findUnique.mockResolvedValue({
        batchNumber,
        status: "AUDITED",
      });
      prismaMock.agentWallet.findUnique.mockResolvedValue({
        subjectCommitment: carrier,
        balance: 1000,
        staked: 0, // 1000 < 5000 required bond
      });

      await expect(
        dispatchDiplomaticTransit({
          waybillNumber: "WAYBILL-FAIL",
          batchNumber,
          destinationPortCode: portCode,
          originVaultId: "VAULT-BKO",
          carrierCommitment: carrier,
          carrierBondAngel: 5000,
          diplomaticSealDigest: sealDigest,
        })
      ).rejects.toThrow(/insufficient collateral/i);
    });
  });

  describe("recordIntermediateCheckpoint", () => {
    it("appends waypoint and preserves IN_TRANSIT status", async () => {
      prismaMock.bondedTransitWaybill.findUnique.mockResolvedValue({
        waybillNumber: "WAYBILL-001",
        status: "DISPATCHED",
        checkpointsVisited: ["SIKASSO"],
      });
      prismaMock.bondedTransitWaybill.update.mockResolvedValue({
        waybillNumber: "WAYBILL-001",
        status: "IN_TRANSIT",
        checkpointsVisited: ["SIKASSO", "OUAGA"],
      });

      const updated = await recordIntermediateCheckpoint({
        waybillNumber: "WAYBILL-001",
        checkpointName: "OUAGA",
        inspectorSignature: "sig",
        inspectorPublicKey: "pk",
      });

      expect(updated.status).toBe("IN_TRANSIT");
      expect(prismaMock.bondedTransitWaybill.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            checkpointsVisited: ["SIKASSO", "OUAGA"],
            status: "IN_TRANSIT",
          }),
        })
      );
    });
  });

  describe("recordPortArrival", () => {
    it("unlocks carrier bond, credits port authority fees, and updates lot to PORT_VAULTED", async () => {
      prismaMock.bondedTransitWaybill.findUnique.mockResolvedValue({
        waybillNumber: "WAYBILL-001",
        batchNumber,
        enclaveId: "enc_1",
        destinationPortCode: portCode,
        status: "IN_TRANSIT",
        carrierCommitment: carrier,
        carrierBondAngel: 5000,
        fineGoldGrams: 500.0,
        diplomaticSealDigest: sealDigest,
        enclave: {
          portCode,
          portName: "Autonomous Port of Lomé",
          countryCode: "TG",
          enclavePublicKey: "pk_lome",
          clearingFeeShareBps: 50, // 0.50%
        },
      });

      vi.spyOn(oracle, "getCommoditySpotPrices").mockReturnValue({
        Au: { symbol: "Au", priceUsd: 75.0, isStale: false },
      } as unknown as Record<string, CommodityPrice>);

      prismaMock.agentWallet.update.mockResolvedValue({});
      prismaMock.coastalPortEnclave.update.mockResolvedValue({});
      prismaMock.vaultBatch.update.mockResolvedValue({});
      prismaMock.bondedTransitWaybill.update.mockResolvedValue({
        waybillNumber: "WAYBILL-001",
        status: "PORT_ARRIVED",
      });

      const arrived = await recordPortArrival({
        waybillNumber: "WAYBILL-001",
        portCode,
        enclaveSignature: "sig_enclave",
      });

      expect(arrived.status).toBe("PORT_ARRIVED");
      // Carrier bond refunded
      expect(prismaMock.agentWallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { subjectCommitment: carrier },
          data: expect.objectContaining({ staked: { decrement: 5000 } }),
        })
      );
      // Batch transitioned to PORT_VAULTED at coastal port enclave
      expect(prismaMock.vaultBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { batchNumber },
          data: expect.objectContaining({
            status: "PORT_VAULTED",
            locationCountry: "TG",
          }),
        })
      );
    });

    it("rejects port arrival if portCode does not match destinationPortCode", async () => {
      prismaMock.bondedTransitWaybill.findUnique.mockResolvedValue({
        waybillNumber: "WAYBILL-001",
        destinationPortCode: "PORT-LOME-TG",
        status: "IN_TRANSIT",
      } as unknown as Awaited<ReturnType<typeof prismaMock.bondedTransitWaybill.findUnique>>);

      await expect(
        recordPortArrival({
          waybillNumber: "WAYBILL-001",
          portCode: "PORT-CONAKRY-GN", // Mismatch
          enclaveSignature: "sig",
        })
      ).rejects.toThrow(/Port code mismatch/i);
    });
  });

  describe("reportSealBreach", () => {
    it("slashes 100% of carrier bond and quarantines physical lot", async () => {
      prismaMock.bondedTransitWaybill.findUnique.mockResolvedValue({
        waybillNumber: "WAYBILL-001",
        batchNumber,
        carrierCommitment: carrier,
        carrierBondAngel: 5000,
        status: "IN_TRANSIT",
      });

      prismaMock.agentWallet.update.mockResolvedValue({});
      prismaMock.agentWallet.upsert.mockResolvedValue({});
      prismaMock.vaultBatch.update.mockResolvedValue({});
      prismaMock.bondedTransitWaybill.update.mockResolvedValue({
        waybillNumber: "WAYBILL-001",
        status: "SEAL_BREACHED",
      });
      vi.spyOn(porService, "generateLivePoR").mockResolvedValue(
        {} as unknown as Awaited<ReturnType<typeof porService.generateLivePoR>>
      );

      const breached = await reportSealBreach({
        waybillNumber: "WAYBILL-001",
        breachEvidence: "Container side-wall drill micro-probe detected",
        reporterCommitment: "r".repeat(64),
      });

      expect(breached.status).toBe("SEAL_BREACHED");
      // 100% economic slashing
      expect(prismaMock.agentWallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { subjectCommitment: carrier },
          data: expect.objectContaining({
            balance: { decrement: 5000 },
            staked: { decrement: 5000 },
            spentTotal: { increment: 5000 },
          }),
        })
      );
      // Slashed bond credited to protocol stabilization fund (conservation of value)
      expect(prismaMock.agentWallet.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { subjectCommitment: "protocol_treasury_system" },
          update: expect.objectContaining({ balance: { increment: 5000 } }),
        })
      );
      // Quarantined lot
      expect(prismaMock.vaultBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { batchNumber },
          data: { status: "QUARANTINED" },
        })
      );
    });
  });

  describe("getTransitMetrics", () => {
    it("aggregates active transit metrics", async () => {
      prismaMock.coastalPortEnclave.findMany.mockResolvedValue([
        { portCode: "PORT-LOME-TG", activeStatus: "ACTIVE" },
      ]);
      prismaMock.bondedTransitWaybill.findMany.mockResolvedValue([
        { fineGoldGrams: 500, status: "IN_TRANSIT", carrierBondAngel: 5000 },
        { fineGoldGrams: 300, status: "PORT_ARRIVED", carrierBondAngel: 5000 },
      ]);

      const metrics = await getTransitMetrics();
      expect(metrics.activeEnclavesCount).toBe(1);
      expect(metrics.activeWaybillsCount).toBe(1);
      expect(metrics.transitFineGoldGrams).toBe(500);
      expect(metrics.totalCarrierBondsLockedAngel).toBe(5000);
      expect(metrics.totalConvoysArrived).toBe(1);
    });
  });
});
