import { describe, it, expect } from "vitest";
import { computeReputationScore, TIER_THRESHOLDS } from "../compute-score";

/**
 * T7 — Sybil / self-deal reputation farming (failure hypothesis F-002).
 *
 * The score formula rewards raw evidence + success rate with NO counterparty
 * diversity and NO fiat-weighting. Therefore a ring of agents controlled by a
 * single operator that transacts only among themselves can farm a Diamond score
 * — making the trust signal worthless. This test pins the exact mechanism and
 * guards it: it FAILS if the formula is later hardened with a diversity/fiat
 * term, at which point the assertions below should be updated to the new
 * expectations.
 */

describe("F-002 · reputation is farmable by a single-operator self-deal ring", () => {
  it("DOCUMENTS THE GAP: pure volume + success reaches Diamond with no diversity requirement", () => {
    // A ring member: 500 evidence rows (self-dealt), perfect success, enrolled,
    // upward trajectory, no corrections/failures. All from ONE operator.
    const farmed = computeReputationScore({
      evidenceCount: 500,
      artifactCount: 200,
      correctionCount: 0,
      failureCount: 0,
      successRate30d: 1.0,
      trajectory7d: "UP",
      isEnrolled: true,
    });

    expect(farmed.score).toBeGreaterThanOrEqual(TIER_THRESHOLDS.diamond);
    expect(farmed.tier).toBe("diamond");

    // There is no input field for counterparty diversity or fiat-backing, so
    // the formula cannot distinguish this from legitimate reputation.
    // REMEDIATION (F-002): add `distinctCounterparties` and `fiatBackedUsd`
    // inputs; require a minimum diversity/fiat floor for upper tiers.
  });

  it("the perfect score is 500 evidence + 100 enroll + 200 success + 50 traj + 100 artifact = 950 (capped 1000)", () => {
    const r = computeReputationScore({
      evidenceCount: 500,
      artifactCount: 200,
      correctionCount: 0,
      failureCount: 0,
      successRate30d: 1.0,
      trajectory7d: "UP",
      isEnrolled: true,
    });
    expect(r.breakdown.evidence).toBe(500);
    expect(r.breakdown.enrollment).toBe(100);
    expect(r.breakdown.successRate).toBe(200);
    expect(r.breakdown.trajectory).toBe(50);
    expect(r.breakdown.artifact).toBe(100);
    expect(r.score).toBe(950);
  });

  it("a small honest agent with modest volume ranks far below a farming ring", () => {
    const honest = computeReputationScore({
      evidenceCount: 20,
      artifactCount: 5,
      correctionCount: 1,
      failureCount: 1,
      successRate30d: 0.6,
      trajectory7d: "FLAT",
      isEnrolled: true,
    });
    // 20 + 100 + 120 + 25 + 2.5 - 2 - 3 = ~262
    expect(honest.score).toBeLessThan(TIER_THRESHOLDS.gold);
  });
});
