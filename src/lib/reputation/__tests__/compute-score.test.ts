import { describe, it, expect } from "vitest";
import {
  computeReputationScore,
  resolveTier,
  getNextTier,
  TIER_THRESHOLDS,
} from "@/lib/reputation/compute-score";

function makeInput(overrides: Partial<Parameters<typeof computeReputationScore>[0]> = {}) {
  return {
    evidenceCount: 0,
    artifactCount: 0,
    correctionCount: 0,
    failureCount: 0,
    successRate30d: null,
    trajectory7d: "DOWN" as const,
    isEnrolled: false,
    ...overrides,
  };
}

describe("computeReputationScore", () => {
  it("returns 0 score with tier bronze for a new unenrolled agent", () => {
    const r = computeReputationScore(makeInput());
    expect(r.score).toBe(0);
    expect(r.tier).toBe("bronze");
    expect(r.tierLabel).toBe("Bronze");
    expect(r.breakdown.evidence).toBe(0);
  });

  it("enrollment bonus adds 100 points", () => {
    const r = computeReputationScore(makeInput({ isEnrolled: true }));
    expect(r.score).toBe(100);
    expect(r.tier).toBe("bronze");
  });

  it("20 evidence entries with good success and enrollment reaches silver", () => {
    const r = computeReputationScore(makeInput({
      isEnrolled: true,
      evidenceCount: 20,
      artifactCount: 10,
      successRate30d: 1.0,
      trajectory7d: "UP",
    }));
    expect(r.tier).toBe("silver");
    expect(r.score).toBeGreaterThanOrEqual(TIER_THRESHOLDS.silver);
    expect(r.tierLabel).toBe("Silver");
  });

  it("50 evidence entries with perfect success reaches gold", () => {
    const r = computeReputationScore(makeInput({
      isEnrolled: true,
      evidenceCount: 50,
      artifactCount: 30,
      successRate30d: 1.0,
      trajectory7d: "UP",
    }));
    expect(r.score).toBeGreaterThanOrEqual(TIER_THRESHOLDS.gold);
    expect(r.tier).toBe("gold");
  });

  it("200 evidence entries with perfect success reaches platinum", () => {
    const r = computeReputationScore(makeInput({
      isEnrolled: true,
      evidenceCount: 350,
      artifactCount: 200,
      successRate30d: 1.0,
      trajectory7d: "UP",
    }));
    expect(r.score).toBeGreaterThanOrEqual(TIER_THRESHOLDS.platinum);
    expect(r.tier).toBe("platinum");
  });

  it("500 evidence entries reaches diamond", () => {
    const r = computeReputationScore(makeInput({
      isEnrolled: true,
      evidenceCount: 500,
      artifactCount: 200,
      successRate30d: 1.0,
      trajectory7d: "UP",
    }));
    expect(r.score).toBeGreaterThanOrEqual(TIER_THRESHOLDS.diamond);
    expect(r.tier).toBe("diamond");
  });

  it("score is clamped at 1000 max", () => {
    const r = computeReputationScore(makeInput({
      isEnrolled: true,
      evidenceCount: 9999,
      artifactCount: 9999,
      successRate30d: 1.0,
      trajectory7d: "UP",
    }));
    expect(r.score).toBeLessThanOrEqual(1000);
  });

  it("failure penalty reduces score significantly", () => {
    const r1 = computeReputationScore(makeInput({ isEnrolled: true, failureCount: 0 }));
    const r2 = computeReputationScore(makeInput({ isEnrolled: true, failureCount: 50 }));
    expect(r2.score).toBeLessThan(r1.score);
    expect(r2.breakdown.failurePenalty).toBe(150);
  });

  it("correction penalty reduces score", () => {
    const r = computeReputationScore(makeInput({ isEnrolled: true, correctionCount: 10 }));
    expect(r.breakdown.correctionPenalty).toBe(20);
  });

  it("UP trajectory adds 50 points", () => {
    const rFlat = computeReputationScore(makeInput({ trajectory7d: "FLAT" }));
    const rUp = computeReputationScore(makeInput({ trajectory7d: "UP" }));
    expect(rUp.breakdown.trajectory - rFlat.breakdown.trajectory).toBe(25);
  });

  it("DOWN trajectory adds 0 points", () => {
    const r = computeReputationScore(makeInput({ trajectory7d: "DOWN" }));
    expect(r.breakdown.trajectory).toBe(0);
  });

  it("nextTier is correct for each tier", () => {
    const bronze = computeReputationScore(makeInput());
    expect(bronze.nextTier).toBe("silver");
    expect(bronze.scoreToNextTier).toBeGreaterThan(0);

    const diamond = computeReputationScore(makeInput({
      isEnrolled: true,
      evidenceCount: 500,
      artifactCount: 200,
      successRate30d: 1.0,
      trajectory7d: "UP",
    }));
    expect(diamond.nextTier).toBeNull();
    expect(diamond.scoreToNextTier).toBe(0);
  });

  it("successRate null gives zero bonus", () => {
    const r = computeReputationScore(makeInput({ successRate30d: null }));
    expect(r.breakdown.successRate).toBe(0);
  });
});

describe("resolveTier", () => {
  it("bronze at 0", () => expect(resolveTier(0)).toBe("bronze"));
  it("silver at 200", () => expect(resolveTier(200)).toBe("silver"));
  it("gold at 400", () => expect(resolveTier(400)).toBe("gold"));
  it("platinum at 650", () => expect(resolveTier(650)).toBe("platinum"));
  it("diamond at 850", () => expect(resolveTier(850)).toBe("diamond"));
  it("diamond at 1000", () => expect(resolveTier(1000)).toBe("diamond"));
});

describe("getNextTier", () => {
  it("bronze → silver", () => expect(getNextTier("bronze")).toBe("silver"));
  it("silver → gold", () => expect(getNextTier("silver")).toBe("gold"));
  it("gold → platinum", () => expect(getNextTier("gold")).toBe("platinum"));
  it("platinum → diamond", () => expect(getNextTier("platinum")).toBe("diamond"));
  it("diamond → null", () => expect(getNextTier("diamond")).toBeNull());
});