import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    vaultBatch: { findUnique: vi.fn(), update: vi.fn() },
    agentWallet: { findUnique: vi.fn(), update: vi.fn() },
    commodityEscrow: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    assayerCertification: { findUnique: vi.fn() },
    sovereignDisbursement: { create: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  createCommodityEscrow,
  releaseEscrowOnAssay,
  refundEscrowOnTimeout,
} from "../rwa-escrow";
import * as oracle from "../commodity-oracle";

const buyer = "a".repeat(64);
const seller = "b".repeat(64);
const batch = "BKO-AU-2026-001";

describe("RWA Commodity Escrow Service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    prismaMock.vaultBatch.findUnique.mockReset();
    prismaMock.vaultBatch.update.mockReset();
    prismaMock.agentWallet.findUnique.mockReset();
    prismaMock.agentWallet.update.mockReset();
    prismaMock.commodityEscrow.create.mockReset();
    prismaMock.commodityEscrow.findUnique.mockReset();
    prismaMock.commodityEscrow.findMany.mockReset();
    prismaMock.commodityEscrow.findMany.mockResolvedValue([]);
    prismaMock.commodityEscrow.update.mockReset();
    prismaMock.assayerCertification.findUnique.mockReset();
    prismaMock.sovereignDisbursement.create.mockReset();
  });

  describe("createCommodityEscrow", () => {
    it("creates a HELD escrow and debits buyer collateral atomically", async () => {
      prismaMock.vaultBatch.findUnique.mockResolvedValue({
        batchNumber: batch,
        status: "AUDITED",
        fineWeightGrams: 1000,
      });
      prismaMock.agentWallet.findUnique.mockResolvedValue({
        subjectCommitment: buyer,
        balance: 500,
        staked: 0,
      });
      prismaMock.agentWallet.update.mockResolvedValue({});
      prismaMock.commodityEscrow.create.mockResolvedValue({
        escrowId: "esc_1",
        status: "HELD",
        lockedAngel: 100,
      });

      const escrow = await createCommodityEscrow({
        escrowId: "esc_1",
        buyerCommitment: buyer,
        sellerCommitment: seller,
        batchNumber: batch,
        fineGrams: 500,
        unitPriceUsd: 75,
        lockedAngel: 100,
      });

      expect(escrow.status).toBe("HELD");
      expect(prismaMock.agentWallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { subjectCommitment: buyer },
          data: expect.objectContaining({ balance: { decrement: 100 } }),
        })
      );
      expect(prismaMock.commodityEscrow.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "HELD",
            buyerCommitment: buyer,
            sellerCommitment: seller,
          }),
        })
      );
    });

    it("refuses escrow creation when the oracle feed is stale", async () => {
      vi.spyOn(oracle, "getCommoditySpotPrices").mockReturnValue({
        Au: {
          symbol: "Au",
          commodityType: "GOLD",
          name: "Fine Physical Gold (99.5%+)",
          unit: "gram",
          priceUsd: 75,
          change24hPercent: 0,
          volatility30dPercent: 4,
          lastUpdated: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
          isStale: true,
          source: "test",
        },
      });

      await expect(
        createCommodityEscrow({
          escrowId: "esc_stale",
          buyerCommitment: buyer,
          sellerCommitment: seller,
          batchNumber: batch,
          fineGrams: 100,
          unitPriceUsd: 75,
          lockedAngel: 10,
        })
      ).rejects.toThrow(/stale/i);
    });

    it("rejects escrow when buyer has insufficient collateral", async () => {
      prismaMock.vaultBatch.findUnique.mockResolvedValue({
        batchNumber: batch,
        status: "AUDITED",
        fineWeightGrams: 1000,
      });
      prismaMock.agentWallet.findUnique.mockResolvedValue({
        subjectCommitment: buyer,
        balance: 50,
        staked: 0,
      });

      await expect(
        createCommodityEscrow({
          escrowId: "esc_low",
          buyerCommitment: buyer,
          sellerCommitment: seller,
          batchNumber: batch,
          fineGrams: 100,
          unitPriceUsd: 75,
          lockedAngel: 100,
        })
      ).rejects.toThrow(/insufficient/i);
    });

    it("rejects escrow when requested grams exceed unallocated lot capacity (prevents double-allocation)", async () => {
      prismaMock.vaultBatch.findUnique.mockResolvedValue({
        batchNumber: batch,
        status: "AUDITED",
        fineWeightGrams: 100, // lot has 100g total
      });
      // 80g already locked in prior HELD escrows
      prismaMock.commodityEscrow.findMany.mockResolvedValue([
        { fineGrams: 80 },
      ] as unknown as Array<{ fineGrams: number }>);

      await expect(
        createCommodityEscrow({
          escrowId: "esc_oversell",
          buyerCommitment: buyer,
          sellerCommitment: seller,
          batchNumber: batch,
          fineGrams: 50, // 50g requested > 20g remaining
          unitPriceUsd: 75,
          lockedAngel: 10,
        })
      ).rejects.toThrow(/exceed available lot capacity/i);
    });
  });

  describe("releaseEscrowOnAssay", () => {
    it("releases escrow to seller after matching assay verification", async () => {
      prismaMock.commodityEscrow.findUnique.mockResolvedValue({
        escrowId: "esc_1",
        status: "HELD",
        sellerCommitment: seller,
        batchNumber: batch,
        lockedAngel: 100,
        protocolFeeAngel: 3,
      });
      prismaMock.assayerCertification.findUnique.mockResolvedValue({
        certificationNumber: "CERT-1",
        batchNumber: batch,
      });
      prismaMock.agentWallet.update.mockResolvedValue({});
      prismaMock.vaultBatch.update.mockResolvedValue({
        locationCountry: "ML",
        locationCity: "Bamako",
      });
      prismaMock.sovereignDisbursement.create.mockResolvedValue({
        id: "disb_1",
        disbursementId: "disb_esc_1",
      });
      prismaMock.commodityEscrow.update.mockResolvedValue({
        escrowId: "esc_1",
        status: "RELEASED",
      });

      const result = await releaseEscrowOnAssay({
        escrowId: "esc_1",
        assayCertificationNumber: "CERT-1",
        releaseSignature: "sig",
      });

      expect(result.status).toBe("RELEASED");
      expect(prismaMock.agentWallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { subjectCommitment: seller },
          data: expect.objectContaining({ balance: { increment: 97 } }),
        })
      );
      expect(prismaMock.vaultBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { batchNumber: batch },
          data: { status: "SETTLED_DELIVERY" },
        })
      );
      expect(prismaMock.sovereignDisbursement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            escrowId: "esc_1",
            batchNumber: batch,
            totalFeeAngel: 3,
            countryCode: "ML",
          }),
        })
      );
    });

    it("rejects release when assay does not match the escrow lot", async () => {
      prismaMock.commodityEscrow.findUnique.mockResolvedValue({
        escrowId: "esc_1",
        status: "HELD",
        sellerCommitment: seller,
        batchNumber: batch,
        lockedAngel: 100,
        protocolFeeAngel: 3,
      });
      prismaMock.assayerCertification.findUnique.mockResolvedValue({
        certificationNumber: "CERT-1",
        batchNumber: "DIFFERENT-BATCH",
      });

      await expect(
        releaseEscrowOnAssay({
          escrowId: "esc_1",
          assayCertificationNumber: "CERT-1",
          releaseSignature: "sig",
        })
      ).rejects.toThrow(/does not match/i);
    });
  });

  describe("refundEscrowOnTimeout", () => {
    it("refunds buyer collateral after timeout", async () => {
      prismaMock.commodityEscrow.findUnique.mockResolvedValue({
        escrowId: "esc_1",
        status: "HELD",
        buyerCommitment: buyer,
        lockedAngel: 100,
        timeoutAt: new Date(Date.now() - 1000),
      });
      prismaMock.agentWallet.update.mockResolvedValue({});
      prismaMock.commodityEscrow.update.mockResolvedValue({
        escrowId: "esc_1",
        status: "REFUNDED",
      });

      const result = await refundEscrowOnTimeout("esc_1");
      expect(result.status).toBe("REFUNDED");
      expect(prismaMock.agentWallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { subjectCommitment: buyer },
          data: expect.objectContaining({
            balance: { increment: 100 },
            spentTotal: { decrement: 100 },
          }),
        })
      );
    });

    it("rejects refund before timeout is reached", async () => {
      prismaMock.commodityEscrow.findUnique.mockResolvedValue({
        escrowId: "esc_1",
        status: "HELD",
        buyerCommitment: buyer,
        lockedAngel: 100,
        timeoutAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      await expect(refundEscrowOnTimeout("esc_1")).rejects.toThrow(/timeout/i);
    });
  });
});
