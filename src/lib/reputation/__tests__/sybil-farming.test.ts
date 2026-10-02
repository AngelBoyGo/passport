import { describe, it, expect } from "vitest";
import { computeReputationScore, maxTierForDiversity, TIER_THRESHOLDS } from "../compute-score";

/**
 * T7 — Sybil / self-deal reputation farming (failure hypothesis F-002) — FIXED.
 *
 * FIX: `computeReputationScore` now accepts `distinctCounterparties` and
 * `fiatBackedUsd` and caps the tier accordingly, so a single-operator ring
 * (≈1 counterparty, $0 fiat) cannot reach the upper tiers on raw volume alone.
 * When those inputs are omitted the legacy score/tier behaviour is unchanged.
 */

const FARMED_INPUT = {
  evidenceCount: 500,
  artifactCount: 200,
  correctionCount: 0,
  failureCount: 0,
  successRate30d: 1.0,
  trajectory7d: "UP" as const,
  isEnrolled: true,
};

describe("F-002 · Sybil resistance", () => {
  it("caps a self-deal ring (1 counterparty, $0 fiat) at Bronze despite Diamond score", () => {
    const r = computeReputationScore({ ...FARMED_INPUT, distinctCounterparties: 1, fiatBackedUsd: 0 });
    // The raw score is still high…
    expect(r.score).toBeGreaterThanOrEqual(TIER_THRESHOLDS.diamond);
    // …but the tier is capped by diversity.
    expect(r.tier).toBe("bronze");
    expect(r.sybilCapped).toBe(true);
  });

  it("caps at Gold for moderate diversity without fiat backing", () => {
    const r = computeReputationScore({ ...FARMED_INPUT, distinctCounterparties: 5, fiatBackedUsd: 0 });
    expect(r.tier).toBe("silver"); // gold requires >= $100 fiat
    expect(r.sybilCapped).toBe(true);
  });

  it("allows Diamond for genuinely diverse, fiat-backed reputation", () => {
    const r = computeReputationScore({ ...FARMED_INPUT, distinctCounterparties: 25, fiatBackedUsd: 10_000 });
    expect(r.tier).toBe("diamond");
    expect(r.sybilCapped).toBe(false);
  });

  it("legacy behaviour unchanged when diversity inputs are omitted", () => {
    const r = computeReputationScore(FARMED_INPUT);
    expect(r.tier).toBe("diamond");
    expect(r.sybilCapped).toBe(false);
  });

  it("maxTierForDiversity is monotonic in diversity and fiat", () => {
    expect(maxTierForDiversity(0, 0)).toBe("bronze");
    expect(maxTierForDiversity(2, 0)).toBe("silver");
    expect(maxTierForDiversity(5, 100)).toBe("gold");
    expect(maxTierForDiversity(10, 1000)).toBe("platinum");
    expect(maxTierForDiversity(20, 5000)).toBe("diamond");
    expect(maxTierForDiversity(100, 1_000_000)).toBe("diamond");
  });
});
