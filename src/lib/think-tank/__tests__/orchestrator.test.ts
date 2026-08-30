import { describe, it, expect } from "vitest";
import {
  computeOrchestrationPlan,
  type AgentInstance,
  type OrchestrationPlan,
} from "@/lib/think-tank/orchestrator";

describe("Orchestrator", () => {
  const allocation = {
    tiers: [
      { instanceCount: 5, costPerInstance: 50, capability: "high_compute_llm", expectedOutput: "analysis" },
      { instanceCount: 3, costPerInstance: 20, capability: "medium_compute", expectedOutput: "search" },
    ],
  };

  function makeInstances(count: number, tier: string): AgentInstance[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `inst_${i}`,
      commitment: `${i.toString(16).padStart(64, "0")}`,
      tier,
      capability: "generic",
      costPerPeriod: parseInt(tier),
      costCurrency: "USD",
      status: "active" as const,
      assignedTask: null,
      totalEarned: 0,
      totalSpent: 0,
      uptimeHours: i * 100,
      lastHeartbeat: null,
      createdAt: new Date().toISOString(),
    }));
  }

  it("plans creation when instances are below desired count", () => {
    const current = makeInstances(2, "50");
    const plan = computeOrchestrationPlan(allocation, current);
    expect(plan.instancesToCreate.length).toBeGreaterThan(0);
    expect(plan.totalCost).toBeGreaterThan(0);
  });

  it("plans stop when instances exceed desired count", () => {
    const current = [
      ...makeInstances(10, "50"),
      ...makeInstances(5, "20"),
    ];
    const plan = computeOrchestrationPlan(allocation, current);
    expect(plan.instancesToStop.length).toBeGreaterThan(0);
  });

  it("produces no changes when current matches desired", () => {
    const current = [
      ...makeInstances(5, "50"),
      ...makeInstances(3, "20"),
    ];
    const plan = computeOrchestrationPlan(allocation, current);
    expect(plan.instancesToCreate.length).toBe(0);
    expect(plan.instancesToStop.length).toBe(0);
  });

  it("produces expected output description", () => {
    const plan = computeOrchestrationPlan(allocation, []);
    expect(plan.expectedOutput).toContain("high_compute_llm");
    expect(plan.expectedOutput).toContain("medium_compute");
  });
});

describe("Orchestrator — executeOrchestrationPlan", () => {
  it("is defined and exports correctly", async () => {
    const { executeOrchestrationPlan } = await import("@/lib/think-tank/orchestrator");
    expect(executeOrchestrationPlan).toBeDefined();
  });
});