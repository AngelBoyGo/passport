import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, leaderboardMock, dispatches, leaseAcquireMock, leaseReleaseMock } = vi.hoisted(() => ({
  prismaMock: {
    agentInstance: { findMany: vi.fn(), update: vi.fn() },
  },
  leaderboardMock: vi.fn(),
  dispatches: vi.fn(),
  leaseAcquireMock: vi.fn(),
  leaseReleaseMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/public-portal/portal-service", () => ({ getLeaderboard: leaderboardMock }));
vi.mock("@/lib/webhooks/webhook-service", () => ({
  evaluateAndDispatchReputationSignals: dispatches,
}));
vi.mock("@/lib/scheduler/lease", () => ({ acquireLease: leaseAcquireMock, releaseLease: leaseReleaseMock }));

const { computeTierSignals, runReputationSweepTick } = await import("@/lib/fleet/reputation-sweep");

beforeEach(() => {
  prismaMock.agentInstance.findMany.mockReset();
  prismaMock.agentInstance.update.mockReset();
  prismaMock.agentInstance.update.mockResolvedValue({});
  leaderboardMock.mockReset();
  dispatches.mockReset();
  leaseAcquireMock.mockReset();
  leaseReleaseMock.mockReset();
});

describe("reputation sweep — pure tier-delta signals", () => {
  it("first observation of sub-gold = baseline, no signal", () => {
    expect(computeTierSignals(null, "bronze")).toBeNull();
    expect(computeTierSignals(null, "silver")).toBeNull();
  });

  it("first observation at gold+ IS a milestone", () => {
    expect(computeTierSignals(null, "gold")).toMatchObject({ kind: "milestone", to: "gold" });
  });

  it("drop dispatches degraded, recovery dispatches restored", () => {
    expect(computeTierSignals("gold", "silver")).toMatchObject({ kind: "degraded", to: "silver" });
    expect(computeTierSignals("silver", "gold")).toMatchObject({ kind: "milestone" });
    expect(computeTierSignals("bronze", "silver")).toMatchObject({ kind: "restored" });
  });

  it("same tier dispatches nothing", () => {
    expect(computeTierSignals("silver", "silver")).toBeNull();
  });

  it("unknown tier never dispatches", () => {
    expect(computeTierSignals("gold", "not_a_tier")).toBeNull();
  });
});

describe("reputation sweep — service path", () => {
  function boardRow(hash: string, tier: string, failure = 0, evidence = 40) {
    return {
      agent_commitment_hash: hash,
      reputation_tier: tier,
      failure_rate_rolling_30d: failure,
      evidence_count: evidence,
    };
  }
  function fleetRow(id: string, hash: string, tier: string | null) {
    return { id, commitment: hash, operatorId: "op1", reputationTier: tier, status: "active" };
  }

  it("dispatches ONLY on tier change and persists the new tier", async () => {
    const h = "a".repeat(64);
    prismaMock.agentInstance.findMany.mockResolvedValue([fleetRow("i1", h, "bronze")]);
    leaderboardMock.mockResolvedValue([boardRow(h, "gold")]);
    dispatches.mockResolvedValue(undefined);

    const result = await runReputationSweepTick({ lease: false });

    expect(dispatches).toHaveBeenCalledTimes(1);
    expect(result.signals_dispatched[0].kind).toBe("milestone");
    expect(prismaMock.agentInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reputationTier: "gold" }) })
    );
  });

  it("no tier change -> no webhook, tier recorded to keep rows in sync", async () => {
    const h = "b".repeat(64);
    prismaMock.agentInstance.findMany.mockResolvedValue([fleetRow("i1", h, "silver")]);
    leaderboardMock.mockResolvedValue([boardRow(h, "silver")]);
    const result = await runReputationSweepTick({ lease: false });
    expect(dispatches).not.toHaveBeenCalled();
    expect(result.signals_dispatched).toEqual([]);
    expect(prismaMock.agentInstance.update).not.toHaveBeenCalled();
  });

  it("a DEGRADED change carries the failure rate in the webhook payload", async () => {
    const h = "c".repeat(64);
    prismaMock.agentInstance.findMany.mockResolvedValue([fleetRow("i2", h, "gold")]);
    leaderboardMock.mockResolvedValue([boardRow(h, "bronze", 0.72, 12)]);
    dispatches.mockResolvedValue(undefined);
    await runReputationSweepTick({ lease: false });
    expect(dispatches).toHaveBeenCalledWith(
      "op1",
      h,
      expect.objectContaining({ event: "reputation.degraded", failure_rate: 0.72 })
    );
  });

  it("fleet bodies with no evidence footprint emit nothing", async () => {
    prismaMock.agentInstance.findMany.mockResolvedValue([fleetRow("i3", "d".repeat(64), null)]);
    leaderboardMock.mockResolvedValue([]);
    const result = await runReputationSweepTick({ lease: false });
    expect(dispatches).not.toHaveBeenCalled();
    expect(result.swept).toBe(1);
  });
});

describe("sweep lease", () => {
  it("skips when another replica holds the license", async () => {
    leaseAcquireMock.mockResolvedValue(null);
    const result = await runReputationSweepTick();
    expect(result.ran_lease).toBe(false);
    expect(prismaMock.agentInstance.findMany).not.toHaveBeenCalled();
  });
});
