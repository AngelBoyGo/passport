import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SovereignDisbursement } from "@prisma/client";
import {
  calculateStatutoryWaterfall,
  executeDisbursementInTransaction,
  getAggregatedDividends,
} from "../royalty-waterfall";
import { prisma } from "@/lib/db";

describe("Sovereign Dividend Waterfall & Anti-Extraction Engine", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("calculateStatutoryWaterfall (Pure Invariants)", () => {
    it("handles zero fee safely with zero allocations", () => {
      const res = calculateStatutoryWaterfall(0, { country: "ML", district: "Bamako" });
      expect(res.totalFeeAngel).toBe(0);
      expect(res.stateNationalAngel).toBe(0);
      expect(res.stateCommunityAngel).toBe(0);
      expect(res.stateWorkersAngel).toBe(0);
      expect(res.treasuryStabilizationAngel).toBe(0);
      expect(res.validatorPoolAngel).toBe(0);
      expect(res.agentRebateAngel).toBe(0);
    });

    it("distributes canonical 100 ANGEL fee exactly according to Black Paper Q141", () => {
      const res = calculateStatutoryWaterfall(100, { country: "BF", district: "Essakane" });

      expect(res.totalFeeAngel).toBe(100);
      // State tier (40%): 40 total -> 50% national (20), 30% community (12), 20% workers (8)
      expect(res.stateNationalAngel).toBe(20);
      expect(res.stateCommunityAngel).toBe(12);
      expect(res.stateWorkersAngel).toBe(8);

      // Other tiers
      expect(res.treasuryStabilizationAngel).toBe(30);
      expect(res.validatorPoolAngel).toBe(20);
      expect(res.agentRebateAngel).toBe(10);

      // Zero-leakage invariant
      const sum =
        res.stateNationalAngel +
        res.stateCommunityAngel +
        res.stateWorkersAngel +
        res.treasuryStabilizationAngel +
        res.validatorPoolAngel +
        res.agentRebateAngel;
      expect(sum).toBe(100);
      expect(res.countryCode).toBe("BF");
      expect(res.districtName).toBe("Essakane");
    });

    it("absorbs fractional integer remainder (dust) into National Treasury for non-round fees", () => {
      // 25 ANGEL fee test
      const res25 = calculateStatutoryWaterfall(25, { country: "NE", district: "Arlit" });
      const sum25 =
        res25.stateNationalAngel +
        res25.stateCommunityAngel +
        res25.stateWorkersAngel +
        res25.treasuryStabilizationAngel +
        res25.validatorPoolAngel +
        res25.agentRebateAngel;
      expect(sum25).toBe(25);
      expect(res25.stateNationalAngel).toBe(6); // absorbed 1 remainder dust

      // Stress test across an extensive range of odd fees
      const testFees = [1, 3, 7, 13, 29, 37, 99, 123, 555, 1337, 10003];
      for (const fee of testFees) {
        const r = calculateStatutoryWaterfall(fee, { country: "ML" });
        const totalAllocated =
          r.stateNationalAngel +
          r.stateCommunityAngel +
          r.stateWorkersAngel +
          r.treasuryStabilizationAngel +
          r.validatorPoolAngel +
          r.agentRebateAngel;
        expect(totalAllocated).toBe(fee);
      }
    });
  });

  describe("executeDisbursementInTransaction", () => {
    it("returns null and skips database write if totalFeeAngel <= 0", async () => {
      const mockTx = {
        sovereignDisbursement: { create: vi.fn() },
      };

      const result = await executeDisbursementInTransaction(mockTx, {
        escrowId: "esc_0",
        batchNumber: "BKO-01",
        totalFeeAngel: 0,
        location: { country: "ML" },
      });

      expect(result).toBeNull();
      expect(mockTx.sovereignDisbursement.create).not.toHaveBeenCalled();
    });

    it("persists SovereignDisbursement record inside provided transaction", async () => {
      const mockTx = {
        sovereignDisbursement: {
          create: vi.fn().mockResolvedValue({
            id: "disb_1",
            disbursementId: "disb_test_123",
            totalFeeAngel: 25,
          }),
        },
      };

      const result = await executeDisbursementInTransaction(mockTx, {
        escrowId: "esc_123",
        batchNumber: "BKO-AU-2026-001",
        totalFeeAngel: 25,
        location: { country: "ML", district: "Sikasso" },
      });

      expect(result).not.toBeNull();
      expect(mockTx.sovereignDisbursement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            escrowId: "esc_123",
            batchNumber: "BKO-AU-2026-001",
            totalFeeAngel: 25,
            countryCode: "ML",
            districtName: "Sikasso",
          }),
        })
      );
    });
  });

  describe("getAggregatedDividends", () => {
    it("aggregates macroeconomic dividend totals across all disbursements", async () => {
      const baseDisb = {
        id: "d1",
        disbursementId: "disb_1",
        escrowId: "esc_1",
        batchNumber: "BKO-1",
        districtName: "Bamako",
        countryCode: "ML",
        disbursedAt: new Date("2026-09-06T12:00:00Z"),
      };

      vi.spyOn(prisma.sovereignDisbursement, "findMany")
        .mockResolvedValueOnce([
          {
            ...baseDisb,
            totalFeeAngel: 100,
            stateNationalAngel: 20,
            stateCommunityAngel: 12,
            stateWorkersAngel: 8,
            treasuryStabilizationAngel: 30,
            validatorPoolAngel: 20,
            agentRebateAngel: 10,
          },
        ])
        .mockResolvedValueOnce([
          {
            ...baseDisb,
            totalFeeAngel: 100,
            stateNationalAngel: 20,
            stateCommunityAngel: 12,
            stateWorkersAngel: 8,
            treasuryStabilizationAngel: 30,
            validatorPoolAngel: 20,
            agentRebateAngel: 10,
          },
          {
            ...baseDisb,
            id: "d2",
            disbursementId: "disb_2",
            totalFeeAngel: 50,
            stateNationalAngel: 10,
            stateCommunityAngel: 6,
            stateWorkersAngel: 4,
            treasuryStabilizationAngel: 15,
            validatorPoolAngel: 10,
            agentRebateAngel: 5,
          },
        ]);

      const data = await getAggregatedDividends(5);

      expect(data.totals.count).toBe(2);
      expect(data.totals.totalFeesCapturedAngel).toBe(150);
      expect(data.totals.nationalTreasuryAngel).toBe(30);
      expect(data.totals.communityTrustAngel).toBe(18);
      expect(data.totals.workersBonusAngel).toBe(12);
      expect(data.totals.treasuryStabilizationAngel).toBe(45);
      expect(data.totals.validatorPoolAngel).toBe(30);
      expect(data.totals.agentRebatesAngel).toBe(15);
      expect(data.recentDisbursements).toHaveLength(1);
    });
  });
});
