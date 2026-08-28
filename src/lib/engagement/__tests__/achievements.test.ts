import { describe, it, expect } from "vitest";
import { computeAchievements, ALL_BADGES } from "@/lib/engagement/achievements";
import type { AchievementInput } from "@/lib/engagement/achievements";

function baseInput(overrides: Partial<AchievementInput> = {}): AchievementInput {
  return {
    evidenceCount: 0,
    streakDays: 0,
    reputationScore: 0,
    reputationTier: "Bronze",
    artifactCount: 0,
    hasEnrollmentPhoto: false,
    correctionCount: 0,
    daysSinceEnrolled: 0,
    ...overrides,
  };
}

describe("computeAchievements", () => {
  it("returns no badges for a brand new agent", () => {
    const result = computeAchievements(baseInput(), []);
    const unlocked = result.filter((b) => b.isNew);
    expect(unlocked.length).toBe(0);
  });

  it("unlocks First Steps badge with 1 evidence", () => {
    const result = computeAchievements(baseInput({ evidenceCount: 1 }), []);
    const firstSteps = result.find((b) => b.id === "first_steps");
    expect(firstSteps).toBeDefined();
    expect(firstSteps!.isNew).toBe(true);
  });

  it("does not re-unlock badges that were already earned", () => {
    const result = computeAchievements(baseInput({ evidenceCount: 1 }), ["first_steps"]);
    const firstSteps = result.find((b) => b.id === "first_steps");
    expect(firstSteps).toBeDefined();
    expect(firstSteps!.isNew).toBe(false);
  });

  it("unlocks Silver Standard badge at Silver tier", () => {
    const result = computeAchievements(baseInput({ reputationTier: "Silver" }), []);
    const badge = result.find((b) => b.id === "silver_tier");
    expect(badge).toBeDefined();
  });

  it("unlocks Gold Rush at Gold tier", () => {
    const result = computeAchievements(baseInput({ reputationTier: "Gold" }), []);
    expect(result.find((b) => b.id === "gold_tier")).toBeDefined();
  });

  it("unlocks Diamond Hands at Diamond tier", () => {
    const result = computeAchievements(baseInput({ reputationTier: "Diamond" }), []);
    expect(result.find((b) => b.id === "diamond_tier")).toBeDefined();
  });

  it("unlocks streak badges at 3, 14, and 30 days", () => {
    const r3 = computeAchievements(baseInput({ streakDays: 3 }), []);
    expect(r3.find((b) => b.id === "streak_spark")).toBeDefined();

    const r14 = computeAchievements(baseInput({ streakDays: 14 }), []);
    expect(r14.find((b) => b.id === "streak_burning")).toBeDefined();

    const r30 = computeAchievements(baseInput({ streakDays: 30 }), []);
    expect(r30.find((b) => b.id === "streak_inferno")).toBeDefined();
  });

  it("unlocks Century badge at 100 evidence", () => {
    const result = computeAchievements(baseInput({ evidenceCount: 100 }), []);
    expect(result.find((b) => b.id === "century")).toBeDefined();
  });

  it("unlocks Multi-Tool at 10 artifacts", () => {
    const result = computeAchievements(baseInput({ artifactCount: 10 }), []);
    expect(result.find((b) => b.id === "artifact_multitool")).toBeDefined();
  });

  it("unlocks Perfectionist at 50 evidence with zero corrections", () => {
    const result = computeAchievements(baseInput({ evidenceCount: 50, correctionCount: 0 }), []);
    expect(result.find((b) => b.id === "perfectionist")).toBeDefined();
  });

  it("does NOT unlock Perfectionist with corrections", () => {
    const result = computeAchievements(baseInput({ evidenceCount: 50, correctionCount: 1 }), []);
    expect(result.find((b) => b.id === "perfectionist")).toBeUndefined();
  });

  it("unlocks Veteran badge at 90+ days", () => {
    const result = computeAchievements(baseInput({ daysSinceEnrolled: 90 }), []);
    expect(result.find((b) => b.id === "veteran")).toBeDefined();
  });

  it("has 12 defined badges", () => {
    expect(ALL_BADGES.length).toBe(12);
  });

  it("all badges have unique IDs", () => {
    const ids = ALL_BADGES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});