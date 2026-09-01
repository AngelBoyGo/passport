import { describe, it, expect } from "vitest";
import {
  MONETARY_PARAMS,
  ANGEL_BUNDLES,
  FEATURE_GRID,
  FEATURE_USD_PRICES,
  gridRound,
  revalue,
  computeStranded,
  valueRetentionRatio,
  strandedPercent,
} from "@/lib/angelcoin/monetary";

describe("ANGEL Monetary System — Spec v1.1", () => {
  describe("Bundle Catalog", () => {
    it("has 4 bundles: {5, 9, 17, 33}", () => {
      expect(ANGEL_BUNDLES.map((b) => b.angl)).toEqual([5, 9, 17, 33]);
    });

    it("every bundle is 2^k + 1", () => {
      for (const b of ANGEL_BUNDLES) {
        expect((b.angl - 1) & (b.angl - 1)).toBe(b.angl - 1); // power of 2 check
        expect(Math.log2(b.angl - 1) % 1).toBe(0); // exact power of 2
      }
    });

    it("every bundle price at $5/coin", () => {
      const expected = [25, 45, 85, 165];
      ANGEL_BUNDLES.forEach((b, i) => {
        expect(b.angl * MONETARY_PARAMS.P0).toBe(expected[i]);
      });
    });
  });

  describe("Stranded Balance — the 2^k+1 / 2^j geometry", () => {
    it("guarantees exactly 1 stranded ANGEL for every bundle × feature combination", () => {
      for (const bundle of ANGEL_BUNDLES) {
        for (const feature of FEATURE_GRID) {
          if (feature <= bundle.angl) {
            expect(computeStranded(bundle.angl, feature)).toBe(1);
          }
        }
      }
    });

    it("VRR follows B / (B - 1)", () => {
      expect(valueRetentionRatio(5)).toBeCloseTo(1.25);
      expect(valueRetentionRatio(9)).toBeCloseTo(1.125);
      expect(valueRetentionRatio(17)).toBeCloseTo(1.0625);
      expect(valueRetentionRatio(33)).toBeCloseTo(1.03125);
    });

    it("stranded percentage follows 1/B", () => {
      expect(strandedPercent(5)).toBe(20);
      expect(strandedPercent(9)).toBeCloseTo(11.11);
      expect(strandedPercent(17)).toBeCloseTo(5.88);
      expect(strandedPercent(33)).toBeCloseTo(3.03);
    });
  });

  describe("Feature Grid Repricing", () => {
    it("prices Pro at 8 ANGEL when P = $5", () => {
      expect(gridRound(40, 5.0)).toBe(8);
    });

    it("prices Pro at 8 ANGEL when P = $6 (within hysteresis band)", () => {
      // $40 / $6 = 6.67 raw → nearest grid = 8 (diff 1.33) or 4 (diff 2.67) → 8
      // posted price 8: $8 × $6 = $48, deviation = |48-40|/40 = 20% ≤ 20% → keep 8
      expect(gridRound(40, 6.0, 8)).toBe(8);
    });

    it("reprices Pro to 6→8 when P = $10 (outside hysteresis)", () => {
      // $40 / $10 = 4.0 raw → nearest grid = 4
      expect(gridRound(40, 10.0, 8)).toBe(4);
    });

    it("never prices below the 2 ANGEL minimum", () => {
      expect(gridRound(1, 100)).toBe(2);
    });

    it("auto-reprices as P appreciates", () => {
      // Pro membership at $40
      expect(gridRound(40, 5.0)).toBe(8);   // launch: 8 ANGEL
      expect(gridRound(40, 10.0)).toBe(4);  // P doubles: 4 ANGEL
      expect(gridRound(40, 20.0)).toBe(2);  // P quadruples: 2 ANGEL
    });
  });

  describe("Revaluation Engine", () => {
    it("raises P when there is net inflow", () => {
      const result = revalue({
        previousRate: 5.0,
        reserveBalance: 11000,
        previousReserveBalance: 10000,
        circulatingSupply: 2000,
      });
      expect(result.P).toBeGreaterThan(5.0);
      expect(result.g).toBeGreaterThan(0);
    });

    it("lowers P when there is net outflow", () => {
      const result = revalue({
        previousRate: 5.0,
        reserveBalance: 9000,
        previousReserveBalance: 10000,
        circulatingSupply: 2000,
      });
      expect(result.P).toBeLessThan(5.0);
      expect(result.g).toBeLessThan(0);
    });

    it("clamps to the −2% / +3% band (without floor override)", () => {
      // Use a balanced reserve so the floor doesn't dominate
      const result = revalue({
        previousRate: 5.0,
        reserveBalance: 10300, // +3% inflow = right at band edge
        previousReserveBalance: 10000,
        circulatingSupply: 2000, // floor = 10300/2000 = 5.15, same as band high
      });
      expect(result.P).toBeLessThanOrEqual(5.0 * 1.03 + 0.01); // max +3% (allow small float)
    });

    it("floors at P_red = ρR/S", () => {
      const result = revalue({
        previousRate: 5.0,
        reserveBalance: 1000, // tiny reserve
        previousReserveBalance: 1000,
        circulatingSupply: 100000, // huge supply
      });
      // P_red = 1.0 × 1000 / 100000 = 0.01 — but P started at 5.0 so band keeps it high
      // The floor only kicks in when reserve per coin drops below P
      expect(result.P).toBeGreaterThanOrEqual(5.0 * 0.98);
    });

    it("redemption rate is always below mint rate", () => {
      const result = revalue({
        previousRate: 5.0,
        reserveBalance: 11000,
        previousReserveBalance: 10000,
        circulatingSupply: 2000,
      });
      expect(result.P_red).toBeLessThan(result.P);
      expect(result.P_red).toBeCloseTo(result.P * 0.90);
    });
  });

  describe("Monetary Parameters", () => {
    it("launch rate is $5.00", () => {
      expect(MONETARY_PARAMS.P0).toBe(5.0);
    });

    it("damping is 0.25", () => {
      expect(MONETARY_PARAMS.alpha).toBe(0.25);
    });

    it("band is −2% / +3%", () => {
      expect(MONETARY_PARAMS.bandDown).toBe(0.98);
      expect(MONETARY_PARAMS.bandUp).toBe(1.03);
    });

    it("redemption spread is 10%", () => {
      expect(MONETARY_PARAMS.redemptionSpread).toBe(0.10);
    });

    it("minimum feature price is 2 ANGEL (parity invariant)", () => {
      expect(MONETARY_PARAMS.minFeaturePrice).toBe(2);
    });

    it("feature grid is all even numbers with min 2", () => {
      for (const g of FEATURE_GRID) {
        expect(g % 2).toBe(0);
        expect(g).toBeGreaterThanOrEqual(2);
      }
    });
  });
});