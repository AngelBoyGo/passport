import { describe, it, expect } from "vitest";
import {
  computeRunId,
  rankOpportunities,
  computeOptimalAllocation,
  extractLessons,
  type ThinkTankInput,
} from "@/lib/think-tank/kernel";
import { computeMemoryId, createInMemoryStore } from "@/lib/think-tank/memory";

function mockInput(overrides: Partial<ThinkTankInput> = {}): ThinkTankInput {
  return {
    systemState: {
      totalAgents: 50,
      activeAgents: 30,
      totalSupply: 100000,
      totalStaked: 20000,
      revenue30d: 5000,
      cost30d: 3000,
      commodityReserve: 15000,
      avgAgentEarnings: 100,
    },
    discoveries: [],
    signals: [],
    history: [],
    goals: ["Generate sustainable revenue", "Expand agent network"],
    ...overrides,
  };
}

describe("Think Tank Kernel", () => {
  describe("computeRunId", () => {
    it("returns deterministic run ID from input", () => {
      const input = mockInput();
      const id1 = computeRunId(input);
      const id2 = computeRunId(input);
      expect(id1).toBe(id2);
      expect(id1).toMatch(/^tt_[0-9a-f]{16}$/);
    });
  });

  describe("rankOpportunities", () => {
    it("ranks by expected value × confidence × effort", () => {
      const opportunities = [
        { rank: 0, title: "High value easy", type: "data_pipeline" as const, expectedValue: 10000, confidence: "very_high" as const, effort: "low" as const, timeToValue: "1 week", description: "Easy win" },
        { rank: 0, title: "Low value hard", type: "trading" as const, expectedValue: 1000, confidence: "low" as const, effort: "high" as const, timeToValue: "1 month", description: "Hard loss" },
      ];
      const ranked = rankOpportunities(opportunities);
      expect(ranked[0].title).toBe("High value easy");
      expect(ranked[0].rank).toBe(1);
    });
  });

  describe("computeOptimalAllocation", () => {
    it("expands when profitable", () => {
      const alloc = computeOptimalAllocation({
        totalAgents: 50,
        activeAgents: 30,
        totalSupply: 100000,
        totalStaked: 20000,
        revenue30d: 10000,
        cost30d: 3000,
        commodityReserve: 50000,
        avgAgentEarnings: 100,
      });
      expect(alloc.totalBudget).toBeGreaterThan(0);
      expect(alloc.tiers.length).toBeGreaterThanOrEqual(2);
    });

    it("is conservative when not profitable", () => {
      const alloc = computeOptimalAllocation({
        totalAgents: 50,
        activeAgents: 30,
        totalSupply: 100000,
        totalStaked: 20000,
        revenue30d: 1000,
        cost30d: 5000,
        commodityReserve: 10000,
        avgAgentEarnings: 100,
      });
      expect(alloc.totalBudget).toBeLessThanOrEqual(2000);
    });
  });

  describe("extractLessons", () => {
    it("extracts lessons from success and failure", () => {
      const history = [
        { decisionId: "d1", expectedValue: 1000, actualValue: 1500, success: true, lessonsLearned: "" },
        { decisionId: "d2", expectedValue: 2000, actualValue: 500, success: false, lessonsLearned: "" },
        { decisionId: "d3", expectedValue: 1000, actualValue: 1200, success: true, lessonsLearned: "" },
        { decisionId: "d4", expectedValue: 3000, actualValue: 3000, success: true, lessonsLearned: "" },
        { decisionId: "d5", expectedValue: 1500, actualValue: 0, success: false, lessonsLearned: "" },
      ];
      const lessons = extractLessons(history);
      expect(lessons.length).toBeGreaterThanOrEqual(2);
      expect(lessons.some((l) => l.includes("accuracy"))).toBe(true);
    });
  });
});

describe("Think Tank Memory", () => {
  it("computeMemoryId is deterministic", () => {
    expect(computeMemoryId("hello", "analysis")).toBe(computeMemoryId("hello", "analysis"));
  });

  it("in-memory store saves and retrieves", async () => {
    const store = createInMemoryStore();
    await store.save({
      runId: "tt_abc123",
      type: "analysis",
      content: "Test analysis content",
      summary: "Test summary",
      value: 100,
      tags: ["test", "analysis"],
    });
    const recent = await store.getRecent("analysis");
    expect(recent.length).toBe(1);
    expect(recent[0].summary).toBe("Test summary");
  });

  it("in-memory store supports search", async () => {
    const store = createInMemoryStore();
    await store.save({ runId: "tt_1", type: "analysis", content: "Bitcoin trading opportunity", summary: "BTC", value: 500, tags: ["crypto"] });
    await store.save({ runId: "tt_2", type: "analysis", content: "Data pipeline for AI training", summary: "Data", value: 300, tags: ["data"] });
    const results = await store.search("bitcoin");
    expect(results.length).toBe(1);
    expect(results[0].summary).toBe("BTC");
  });

  it("getStats returns correct counts", async () => {
    const store = createInMemoryStore();
    await store.save({ runId: "tt_1", type: "analysis", content: "A", summary: "A", value: 100, tags: [] });
    await store.save({ runId: "tt_1", type: "opportunity", content: "B", summary: "B", value: 200, tags: [] });
    await store.save({ runId: "tt_2", type: "analysis", content: "C", summary: "C", value: 300, tags: [] });
    const stats = await store.getStats();
    expect(stats.totalEntries).toBe(3);
    expect(stats.byType.analysis).toBe(2);
    expect(stats.totalValue).toBe(600);
  });
});