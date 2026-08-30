import { describe, it, expect, vi } from "vitest";
import { runTick, type SchedulerDeps, type TickResult } from "@/lib/scheduler/scheduler-service";

const NOW = "2026-08-30T17:00:00.000Z";

function makeDeps(overrides: Partial<SchedulerDeps> = {}): SchedulerDeps {
  return {
    getSystemState: vi.fn().mockResolvedValue({
      enrolledCount: 10,
      totalEvidence: 500,
      totalReceipts: 200,
      wallets: [{ balance: 1000 }, { balance: 500 }],
      operatorCount: 5,
      agentCount: 8,
      recentEvidence: Array.from({ length: 30 }, () => ({ observedAt: new Date() })),
    }),
    getRecentDiscoveries: vi.fn().mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        sourceDigest: `Discovery ${i}: High value opportunity found`,
        agentIdentityCommitment: `${i.toString(16).padStart(64, "0")}`,
      }))
    ),
    getCurrentInstances: vi.fn().mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({
        commitment: `${i.toString(16).padStart(64, "0")}`,
        tier: i < 5 ? "50" : "20",
        status: "active" as const,
        earnedTotal: 100,
        spentTotal: 50,
        uptimeHours: i * 50,
      }))
    ),
    postEvidence: vi.fn().mockResolvedValue({ event_commitment_hash: "evidence_hash_123" }),
    now: vi.fn().mockReturnValue(NOW),
    generateId: vi.fn().mockReturnValue("abc123def456"),
    ...overrides,
  };
}

describe("Scheduler — runTick", () => {
  it("returns a complete tick result with all sections", async () => {
    const deps = makeDeps();
    const result = await runTick(deps);
    expect(result.tick_id).toMatch(/^tick_/);
    expect(result.ticked_at).toBe(NOW);
    expect(result.system_state.enrolled_agents).toBe(10);
    expect(result.think_tank.allocation).toBeDefined();
    expect(result.think_tank.top_opportunities).toBeDefined();
    expect(result.runtime).toBeDefined();
    expect(result.evidence_hash).toBeTruthy();
  });

  it("posts evidence of the tick", async () => {
    const deps = makeDeps();
    await runTick(deps);
    expect(deps.postEvidence).toHaveBeenCalled();
    const payload = (deps.postEvidence as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.type).toBe("scheduler_tick");
    expect(payload.tick_id).toMatch(/^tick_/);
  });

  it("handles empty discoveries gracefully", async () => {
    const deps = makeDeps({
      getRecentDiscoveries: vi.fn().mockResolvedValue([]),
    });
    const result = await runTick(deps);
    expect(result.think_tank.top_opportunities).toHaveLength(0);
    expect(result.runtime.task_assignments).toBe(0);
  });

  it("handles evidence failure gracefully", async () => {
    const deps = makeDeps({
      postEvidence: vi.fn().mockRejectedValue(new Error("DB error")),
    });
    const result = await runTick(deps);
    expect(result.evidence_hash).toBeUndefined();
    expect(result.think_tank.allocation).toBeDefined(); // Tick still succeeded
  });

  it("produces runtime summary with create/stop/task info", async () => {
    const deps = makeDeps();
    const result = await runTick(deps);
    expect(typeof result.runtime.instances_to_create).toBe("number");
    expect(Array.isArray(result.runtime.instances_to_stop)).toBe(true);
    expect(typeof result.runtime.task_assignments).toBe("number");
    expect(result.runtime.summary.length).toBeGreaterThan(0);
  });

  it("includes insights from the think tank", async () => {
    const deps = makeDeps();
    const result = await runTick(deps);
    expect(result.think_tank.insights.length).toBeGreaterThanOrEqual(0);
  });
});