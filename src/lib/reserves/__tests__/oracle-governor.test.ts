import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SovereignQuorumProposal } from "@prisma/client";
import {
  isFeedStale,
  isPriceWithinBounds,
  getCommoditySpotPrices,
  computeLotValueUsd,
} from "../commodity-oracle";
import {
  computeBasketValuation,
} from "../basket-valuation";
import {
  computeBayesianStressBelief,
  calculateDampingFeeBps,
  evaluateProgrammaticRevival,
  evaluateDualState,
  getLiveGovernorAssessment,
  GOVERNOR_PARAMS,
  type TelemetryEvidence,
} from "../dual-state-governor";
import { prisma } from "@/lib/db";

describe("Commodity Oracle & Basket Valuation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Commodity Oracle", () => {
    it("returns benchmark spot prices for Au, Li, and Nd", () => {
      const prices = getCommoditySpotPrices();
      expect(prices.Au).toBeDefined();
      expect(prices.Li).toBeDefined();
      expect(prices.Nd).toBeDefined();

      expect(prices.Au.priceUsd).toBe(75.0);
      expect(prices.Au.unit).toBe("gram");
      expect(prices.Li.priceUsd).toBe(14.25);
      expect(prices.Nd.priceUsd).toBe(71.5);
    });

    it("correctly identifies stale feeds", () => {
      const freshDate = new Date();
      const staleDate = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 hours ago

      expect(isFeedStale(freshDate)).toBe(false);
      expect(isFeedStale(staleDate)).toBe(true);
      expect(isFeedStale("invalid-date")).toBe(true);
    });

    it("detects price outliers outside statistical bounds", () => {
      expect(isPriceWithinBounds(76.0, 75.0, 10.0)).toBe(true);
      expect(isPriceWithinBounds(120.0, 75.0, 25.0)).toBe(false);
      expect(isPriceWithinBounds(-10.0, 75.0)).toBe(false);
    });

    it("computes lot values accurately", () => {
      const goldValue = computeLotValueUsd("GOLD", 1000.0, 75.0);
      expect(goldValue).toBe(75000.0);
    });
  });

  describe("Basket Valuation Engine", () => {
    it("calculates gross value, carry costs, and backing ratios", () => {
      const holdings = [
        { commodityType: "GOLD", symbol: "Au", fineUnits: 1000 }, // 1000g * $75 = $75,000
        { commodityType: "LITHIUM", symbol: "Li", fineUnits: 1000 }, // 1000kg * $14.25 = $14,250
      ];

      const valuation = computeBasketValuation({
        holdings,
        circulatingSupply: 10000, // 10,000 ANGEL
        tokenPriceUsd: 5.0, // $50,000 nominal liability
        carryRatePercent: 0.5, // 0.5% annualized
      });

      expect(valuation.totalGrossValueUsd).toBe(89250.0);
      expect(valuation.annualCarryCostUsd).toBeCloseTo(446.25);
      expect(valuation.netReserveValueUsd).toBeCloseTo(88803.75);

      // Backing ratio = 88803.75 / 50000 = ~1.7761
      expect(valuation.solvencyMetrics.backingRatio).toBeGreaterThan(1.5);
      expect(valuation.solvencyMetrics.isSolvent).toBe(true);
      expect(valuation.solvencyMetrics.reserveFloorPriceUsd).toBeGreaterThan(8.0);
    });

    it("correctly flags undercollateralized state", () => {
      const holdings = [
        { commodityType: "GOLD", symbol: "Au", fineUnits: 100 }, // 100g * $75 = $7,500
      ];

      const valuation = computeBasketValuation({
        holdings,
        circulatingSupply: 5000, // 5,000 ANGEL * $5 = $25,000 liability
        tokenPriceUsd: 5.0,
      });

      expect(valuation.solvencyMetrics.backingRatio).toBeLessThan(1.0);
      expect(valuation.solvencyMetrics.isSolvent).toBe(false);
    });
  });

  describe("Dual-State Governor (Markov-Bayesian)", () => {
    const normalEvidence: TelemetryEvidence = {
      oracleStale: false,
      max24hVolatilityPercent: 3.5,
      quarantinedBatchCount: 0,
      backingRatio: 1.5,
      lastTelemetryHeartbeatMs: 60 * 1000,
    };

    it("remains in SOLID regime under healthy conditions", () => {
      const { belief, triggers } = computeBayesianStressBelief(normalEvidence);
      expect(belief).toBeLessThan(GOVERNOR_PARAMS.stressThresholdBelief);
      expect(triggers).toHaveLength(0);

      const fee = calculateDampingFeeBps(belief);
      expect(fee).toBe(GOVERNOR_PARAMS.baseFeeBps);
    });

    it("transitions to GHOST regime under volatility and stale feeds", () => {
      const stressedEvidence: TelemetryEvidence = {
        oracleStale: true,
        max24hVolatilityPercent: 18.5, // > 10%
        quarantinedBatchCount: 2,
        backingRatio: 0.85, // undercollateralized
        lastTelemetryHeartbeatMs: 25 * 60 * 1000, // 25 min silence
      };

      const { belief, triggers } = computeBayesianStressBelief(stressedEvidence);
      expect(belief).toBeGreaterThanOrEqual(GOVERNOR_PARAMS.stressThresholdBelief);
      expect(triggers.length).toBeGreaterThanOrEqual(4);

      const assessment = evaluateDualState(
        stressedEvidence,
        computeBasketValuation({ holdings: [] })
      );
      expect(assessment.regime).toBe("GHOST");
      expect(assessment.circuitBreakerActive).toBe(true);
      expect(assessment.dampingFeeBps).toBeGreaterThan(GOVERNOR_PARAMS.baseFeeBps);
      expect(assessment.dampingFeeBps).toBeLessThanOrEqual(GOVERNOR_PARAMS.maxFeeBps);
    });

    it("evaluates programmatic revival eligibility", () => {
      expect(evaluateProgrammaticRevival(normalEvidence)).toBe(true);

      const badEvidence: TelemetryEvidence = {
        ...normalEvidence,
        quarantinedBatchCount: 1,
      };
      expect(evaluateProgrammaticRevival(badEvidence)).toBe(false);
    });

    it("generates live signed governor assessment", async () => {
      vi.spyOn(prisma.vaultBatch, "count").mockResolvedValue(0);
      vi.spyOn(prisma.commodityReserve, "findMany").mockResolvedValue([
        {
          id: "res_au",
          commodityType: "GOLD",
          symbol: "Au",
          totalGrams: 25000,
          totalFineGrams: 24975,
          activeLotsCount: 1,
          latestMerkleRoot: "root",
          lastAuditedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      vi.spyOn(prisma.agentWallet, "findMany").mockResolvedValue([
        {
          id: "w_1",
          subjectCommitment: "0".repeat(64),
          balance: 2000,
          staked: 0,
          earnedTotal: 2000,
          spentTotal: 0,
          lastActivityAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      vi.spyOn(prisma.sovereignQuorumProposal, "findFirst").mockResolvedValue(null);

      const assessment = await getLiveGovernorAssessment();
      expect(assessment.regime).toBeDefined();
      expect(assessment.beliefScore).toBeGreaterThanOrEqual(0);
      expect(assessment.signature).toBeTruthy();
      expect(assessment.public_key).toBeTruthy();
      expect(assessment.algorithm).toBe("ed25519");
    });

    it("forces GHOST regime and maximum damping fee when an EMERGENCY_FREEZE proposal was executed by Sovereign Quorum", async () => {
      vi.spyOn(prisma.vaultBatch, "count").mockResolvedValue(0);
      vi.spyOn(prisma.commodityReserve, "findMany").mockResolvedValue([]);
      vi.spyOn(prisma.agentWallet, "findMany").mockResolvedValue([]);
      vi.spyOn(prisma.sovereignQuorumProposal, "findFirst").mockResolvedValue({
        id: "prop_1",
        actionType: "EMERGENCY_FREEZE",
        status: "EXECUTED",
        executedAt: new Date(),
      } as unknown as SovereignQuorumProposal);

      const assessment = await getLiveGovernorAssessment();
      expect(assessment.regime).toBe("GHOST");
      expect(assessment.beliefScore).toBe(1.0);
      expect(assessment.dampingFeeBps).toBe(GOVERNOR_PARAMS.maxFeeBps);
      expect(assessment.circuitBreakerActive).toBe(true);
      expect(assessment.revivalEligible).toBe(false);
      expect(assessment.triggers.some((t) => t.includes("Sovereign Quorum"))).toBe(true);
    });
  });
});
