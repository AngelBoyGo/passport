import { describe, it, expect } from "vitest";
import { computeRuntimeCycle, type RuntimeCycleInput } from "@/lib/agent-runtime/runtime-service";

function makeInput(overrides: Partial<RuntimeCycleInput> = {}): RuntimeCycleInput {
  return {
    allocation: {
      tiers: [
        { instanceCount: 3, costPerInstance: 50, capability: "high_compute_llm", expectedOutput: "analysis" },
        { instanceCount: 2, costPerInstance: 20, capability: "medium_compute", expectedOutput: "search" },
      ],
    },
    currentInstances: [
      { commitment: "a".repeat(64), tier: "50", status: "active", earnedTotal: 200, spentTotal: 100, uptimeHours: 120 },
      { commitment: "b".repeat(64), tier: "50", status: "active", earnedTotal: 150, spentTotal: 80, uptimeHours: 72 },
    ],
    treasuryBalance: 500,
    availableTasks: [
      { description: "Analyze AI training data trends", value: 100, searchQuery: "AI training data marketplace 2026", confidence: 0.8 },
      { description: "Scrape Hugging Face top datasets", value: 75, searchQuery: "top selling datasets Hugging Face", confidence: 0.7 },
      { description: "Monitor GPU pricing arbitrage", value: 50, searchQuery: "GPU rental pricing arbitrage", confidence: 0.6 },
      { description: "Research AI compliance opportunities", value: 25, searchQuery: "AI compliance service opportunities", confidence: 0.4 },
    ],
    ...overrides,
  };
}

describe("computeRuntimeCycle", () => {
  it("1. creates instances when below target count", () => {
    const input = makeInput();
    const result = computeRuntimeCycle(input);
    expect(result.instancesToCreate).toBeGreaterThan(0);
    expect(result.instancesToCreate).toBeLessThanOrEqual(8); // (3+2) - 2 = 3, capped by budget
    expect(result.instancesToStop).toHaveLength(0);
  });

  it("2. stops instances when above target count", () => {
    const input = makeInput({
      currentInstances: [
        ...Array.from({ length: 6 }, (_, i) => ({
          commitment: `${i.toString(16).padStart(64, "0")}`,
          tier: "50",
          status: "active" as const,
          earnedTotal: 100,
          spentTotal: 50,
          uptimeHours: i * 100,
        })),
        ...Array.from({ length: 4 }, (_, i) => ({
          commitment: `${(i + 10).toString(16).padStart(64, "0")}`,
          tier: "20",
          status: "active" as const,
          earnedTotal: 50,
          spentTotal: 25,
          uptimeHours: i * 50,
        })),
      ],
    });
    const result = computeRuntimeCycle(input);
    expect(result.instancesToStop.length).toBeGreaterThan(0);
    // 6 active in tier 50, want 3 → stop 3. 4 active in tier 20, want 2 → stop 2
    expect(result.instancesToStop.length).toBe(5);
  });

  it("3. assigns highest-value tasks to active instances", () => {
    const input = makeInput({
      currentInstances: [
        { commitment: "a".repeat(64), tier: "50", status: "active", earnedTotal: 200, spentTotal: 100, uptimeHours: 120 },
        { commitment: "b".repeat(64), tier: "50", status: "active", earnedTotal: 150, spentTotal: 80, uptimeHours: 72 },
        { commitment: "c".repeat(64), tier: "20", status: "active", earnedTotal: 100, spentTotal: 50, uptimeHours: 48 },
      ],
      availableTasks: [
        { description: "High value task", value: 200, searchQuery: "high value", confidence: 0.9 },
        { description: "Medium value task", value: 100, searchQuery: "medium value", confidence: 0.7 },
        { description: "Low value task", value: 50, searchQuery: "low value", confidence: 0.5 },
      ],
    });
    const result = computeRuntimeCycle(input);
    expect(result.taskAssignments.length).toBeGreaterThan(0);
    expect(result.taskAssignments[0].expectedValue).toBeGreaterThanOrEqual(100);
    expect(result.taskAssignments[0].searchQuery).toBeTruthy();
  });

  it("4. skips tasks when budget is insufficient", () => {
    const input = makeInput({
      treasuryBalance: 10,
      availableTasks: [
        { description: "Expensive task", value: 100, searchQuery: "expensive", confidence: 0.9 },
      ],
    });
    const result = computeRuntimeCycle(input);
    // $10 budget can't cover any tier cost (min $20) or any task ($100)
    expect(result.instancesToCreate).toBe(0);
    expect(result.taskAssignments).toHaveLength(0);
  });

  it("5. reports revenue from completed tasks", () => {
    const input = makeInput();
    const result = computeRuntimeCycle(input);
    expect(result.totalRevenue).toBeGreaterThanOrEqual(0);
    expect(result.totalCost).toBeGreaterThanOrEqual(0);
    expect(result.profitability).toBeGreaterThanOrEqual(0);
  });

  it("6. handles empty tiers gracefully", () => {
    const input = makeInput({ allocation: { tiers: [] }, availableTasks: [] });
    const result = computeRuntimeCycle(input);
    expect(result.instancesToCreate).toBe(0);
    expect(result.instancesToStop).toHaveLength(0);
    expect(result.summary).toContain("No changes");
  });

  it("7. caps creation at treasury balance", () => {
    const input = makeInput({
      treasuryBalance: 30, // Only enough for 1 instance at $20
      currentInstances: [], // 0 instances, want 3+2 = 5
    });
    const result = computeRuntimeCycle(input);
    // Can only create instances that fit in $30 budget
    // First tier costs $50 — can't afford any. Second tier costs $20 — can afford 1
    expect(result.instancesToCreate).toBeLessThanOrEqual(1);
    expect(result.totalCost).toBeLessThanOrEqual(30);
  });

  it("8. no changes when current matches target perfectly", () => {
    const input = makeInput({
      allocation: {
        tiers: [
          { instanceCount: 3, costPerInstance: 50, capability: "high_compute_llm", expectedOutput: "analysis" },
        ],
      },
      currentInstances: [
        { commitment: "a".repeat(64), tier: "50", status: "active", earnedTotal: 200, spentTotal: 100, uptimeHours: 120 },
        { commitment: "b".repeat(64), tier: "50", status: "active", earnedTotal: 150, spentTotal: 80, uptimeHours: 72 },
        { commitment: "c".repeat(64), tier: "50", status: "active", earnedTotal: 100, spentTotal: 50, uptimeHours: 48 },
      ],
      availableTasks: [],
    });
    const result = computeRuntimeCycle(input);
    expect(result.instancesToCreate).toBe(0);
    expect(result.instancesToStop).toHaveLength(0);
    expect(result.taskAssignments).toHaveLength(0);
    expect(result.summary).toContain("No changes");
  });
});