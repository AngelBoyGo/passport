import { describe, it, expect } from "vitest";
import {
  ANGL_BATCHES,
  FEATURE_PRICES,
  validateBatchEconomy,
  recommendBatch,
  calculateLeftover,
} from "@/lib/angelcoin/batch-economy";

describe("AngelCoin Batch Economy", () => {
  it("has 7 batch sizes", () => {
    expect(ANGL_BATCHES.length).toBe(7);
  });

  it("batch sizes are prime numbers", () => {
    const sizes = ANGL_BATCHES.map((b) => b.angl);
    expect(sizes).toEqual([17, 53, 157, 521, 1567, 5003, 45061]);
    // Verify primality
    for (const size of sizes) {
      for (let i = 2; i * i <= size; i++) {
        expect(size % i).not.toBe(0);
      }
    }
  });

  it("batch sizes are strictly increasing", () => {
    for (let i = 1; i < ANGL_BATCHES.length; i++) {
      expect(ANGL_BATCHES[i].angl).toBeGreaterThan(ANGL_BATCHES[i - 1].angl);
    }
  });

  it("USD cents equal ANGL (1 ANGL = $0.01)", () => {
    for (const batch of ANGL_BATCHES) {
      expect(batch.usd_cents).toBe(batch.angl);
    }
  });

  it("CORE INVARIANT: no batch divides evenly into any feature", () => {
    const { valid, violations } = validateBatchEconomy();
    expect(violations).toEqual([]);
    expect(valid).toBe(true);
  });

  it("Pro subscription (4995) never divides evenly into any batch", () => {
    const proCost = FEATURE_PRICES.pro_subscription_monthly;
    for (const batch of ANGL_BATCHES) {
      if (batch.angl > proCost) {
        expect(batch.angl % proCost).not.toBe(0);
      }
      expect(proCost % batch.angl).not.toBe(0);
    }
  });

  it("Compliance package (20000) never divides evenly into any batch", () => {
    const compCost = FEATURE_PRICES.compliance_package;
    for (const batch of ANGL_BATCHES) {
      if (batch.angl > compCost) {
        expect(batch.angl % compCost).not.toBe(0);
      }
      expect(compCost % batch.angl).not.toBe(0);
    }
  });

  it("every feature has a recommended batch with leftover", () => {
    for (const [feature, cost] of Object.entries(FEATURE_PRICES)) {
      if (cost === 0) continue;
      const batch = recommendBatch(cost);
      expect(batch).not.toBeNull();
      const leftover = calculateLeftover(batch!.angl, cost);
      expect(leftover).toBeGreaterThan(0);
    }
  });
});

describe("recommendBatch", () => {
  it("recommends Starter for a credential (5 ANGL)", () => {
    const batch = recommendBatch(FEATURE_PRICES.metered_credential);
    expect(batch?.batch_id).toBe("starter");
    expect(batch!.angl).toBe(17);
    expect(calculateLeftover(17, 5)).toBe(12);
  });

  it("recommends Business for Pro subscription (4995 ANGL)", () => {
    const batch = recommendBatch(FEATURE_PRICES.pro_subscription_monthly);
    expect(batch?.batch_id).toBe("business");
    expect(batch!.angl).toBe(5003);
    expect(calculateLeftover(5003, 4995)).toBe(8);
  });

  it("recommends Whale for compliance package (20000 ANGL)", () => {
    const batch = recommendBatch(FEATURE_PRICES.compliance_package);
    expect(batch?.batch_id).toBe("whale");
    expect(batch!.angl).toBe(45061);
    expect(calculateLeftover(45061, 20000)).toBe(25061);
  });
});

describe("calculateLeftover", () => {
  it("always has leftover when batch covers feature", () => {
    expect(calculateLeftover(17, 5)).toBe(12);
    expect(calculateLeftover(5003, 4995)).toBe(8);
    expect(calculateLeftover(45059, 20000)).toBe(25059);
  });

  it("returns 0 when batch is too small", () => {
    expect(calculateLeftover(17, 100)).toBe(0);
  });
});