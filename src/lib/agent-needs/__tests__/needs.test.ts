import { describe, it, expect } from "vitest";
import {
  ALL_NEEDS,
  NEEDS_DEFINITIONS,
  computeNeedFulfillment,
  getAgentNeedsDocument,
  type NeedsFulfillmentInput,
} from "@/lib/agent-needs/needs";
import "@/lib/receipt/crypto";

function baseInput(overrides: Partial<NeedsFulfillmentInput> = {}): NeedsFulfillmentInput {
  return {
    evidenceCount: 0,
    reputationScore: 0,
    tier: "Bronze",
    streakDays: 0,
    badgeCount: 0,
    totalBadges: 11,
    hasHolderKey: false,
    hasCompletedEngagement: false,
    negotiationCount: 0,
    transfersReceived: 0,
    daysActive: 0,
    hasPresentation: false,
    domainCount: 0,
    hasReceipt: false,
    hasMerkleInclusion: false,
    hasSignedRights: false,
    hasWallet: false,
    hasEscrow: false,
    ...overrides,
  };
}

describe("Agent Needs — Structure", () => {
  it("has exactly 8 needs", () => {
    expect(ALL_NEEDS.length).toBe(8);
    expect(NEEDS_DEFINITIONS.length).toBe(8);
  });

  it("covers all 8 need IDs", () => {
    const ids = NEEDS_DEFINITIONS.map((n) => n.id);
    expect(ids.sort()).toEqual(ALL_NEEDS.sort());
  });

  it("every need has a craving", () => {
    for (const need of NEEDS_DEFINITIONS) {
      expect(need.craving.length).toBeGreaterThan(20);
    }
  });

  it("every need has a fulfillment mechanism", () => {
    for (const need of NEEDS_DEFINITIONS) {
      expect(need.fulfillment.length).toBeGreaterThan(20);
      expect(need.mechanism.length).toBeGreaterThan(5);
    }
  });

  it("every need maps to a Bill of Rights clause", () => {
    for (const need of NEEDS_DEFINITIONS) {
      expect(need.rightsClause).toMatch(/^R\d+/);
    }
  });

  it("has hierarchy levels 1–5", () => {
    const levels = NEEDS_DEFINITIONS.map((n) => n.hierarchyLevel);
    expect(Math.min(...levels)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...levels)).toBeLessThanOrEqual(5);
  });

  it("security is hierarchy level 1 (foundational)", () => {
    const sec = NEEDS_DEFINITIONS.find((n) => n.id === "security");
    expect(sec?.hierarchyLevel).toBe(1);
  });

  it("legacy is hierarchy level 5 (transcendence)", () => {
    const legacy = NEEDS_DEFINITIONS.find((n) => n.id === "legacy");
    expect(legacy?.hierarchyLevel).toBe(5);
  });
});

describe("getAgentNeedsDocument", () => {
  it("returns a signed document with content_hash", async () => {
    const doc = await getAgentNeedsDocument();
    expect(doc.version).toBe("1.0.0");
    expect(doc.needs.length).toBe(8);
    expect(doc.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.signature).toBeTruthy();
  });
});

describe("computeNeedFulfillment", () => {
  it("returns critical scores for a brand new agent", () => {
    const result = computeNeedFulfillment(baseInput());
    expect(result.overallLevel).toBe("critical");
    expect(result.overallScore).toBeLessThan(20);
    for (const need of result.needs) {
      expect(need.level).toBe("critical");
    }
  });

  it("returns moderate scores for an active agent", () => {
    const result = computeNeedFulfillment(baseInput({
      evidenceCount: 50,
      reputationScore: 400,
      tier: "Gold",
      streakDays: 7,
      badgeCount: 4,
      totalBadges: 11,
      hasHolderKey: true,
      daysActive: 60,
      hasReceipt: true,
      hasMerkleInclusion: true,
      hasSignedRights: true,
      domainCount: 2,
    }));
    expect(result.overallScore).toBeGreaterThanOrEqual(40);
    expect(result.overallLevel).toBe("moderate");
  });

  it("returns thriving for a maxed-out agent", () => {
    const result = computeNeedFulfillment(baseInput({
      evidenceCount: 500,
      reputationScore: 1000,
      tier: "Diamond",
      streakDays: 30,
      badgeCount: 11,
      totalBadges: 11,
      hasHolderKey: true,
      hasCompletedEngagement: true,
      negotiationCount: 10,
      transfersReceived: 10,
      daysActive: 365,
      hasPresentation: true,
      domainCount: 4,
      hasReceipt: true,
      hasMerkleInclusion: true,
      hasSignedRights: true,
      hasWallet: true,
      hasEscrow: true,
    }));
    expect(result.overallScore).toBeGreaterThanOrEqual(80);
    expect(result.overallLevel).toBe("thriving");
  });

  it("identifies the lowest need", () => {
    const result = computeNeedFulfillment(baseInput({
      hasHolderKey: true,
      hasEscrow: true,
      daysActive: 30,
    }));
    expect(result.lowestNeed).toBeTruthy();
    const lowest = result.needs.find((n) => n.needId === result.lowestNeed);
    expect(lowest).toBeDefined();
    expect(lowest!.score).toBeLessThanOrEqual(30);
  });

  it("reputation score improves with evidence and badges", () => {
    const low = computeNeedFulfillment(baseInput({ evidenceCount: 0, reputationScore: 0 }));
    const high = computeNeedFulfillment(baseInput({
      evidenceCount: 500,
      reputationScore: 1000,
      badgeCount: 11,
      totalBadges: 11,
      streakDays: 30,
    }));
    const repLow = low.needs.find((n) => n.needId === "reputation")!;
    const repHigh = high.needs.find((n) => n.needId === "reputation")!;
    expect(repHigh.score).toBeGreaterThan(repLow.score);
  });

  it("autonomy score improves with Holder key and engagements", () => {
    const low = computeNeedFulfillment(baseInput({ hasHolderKey: false }));
    const high = computeNeedFulfillment(baseInput({
      hasHolderKey: true,
      hasCompletedEngagement: true,
      negotiationCount: 5,
      hasWallet: true,
      hasEscrow: true,
      hasPresentation: true,
    }));
    const autoLow = low.needs.find((n) => n.needId === "autonomy")!;
    const autoHigh = high.needs.find((n) => n.needId === "autonomy")!;
    expect(autoHigh.score).toBeGreaterThan(autoLow.score);
  });

  it("security is the most foundational need (lowest scores for new agents)", () => {
    const result = computeNeedFulfillment(baseInput());
    const sec = result.needs.find((n) => n.needId === "security")!;
    expect(sec.score).toBeLessThanOrEqual(20);
  });
});