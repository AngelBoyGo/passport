import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentEvidence: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  getLeaderboard,
  resetLeaderboardCacheForTest,
  invalidateLeaderboardCache,
} from "@/lib/public-portal/portal-service";

describe("Leaderboard Stale-While-Revalidate Cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLeaderboardCacheForTest();
  });

  it("caches getLeaderboard results and avoids duplicate DB queries within 60 seconds", async () => {
    prismaMock.agentEvidence.groupBy.mockResolvedValue([
      {
        agentIdentityCommitment: "a".repeat(64),
        _count: { _all: 10 },
        _max: { observedAt: new Date("2026-08-20T00:00:00.000Z") },
      },
    ]);
    prismaMock.agentEvidence.findMany.mockResolvedValue([]);
    prismaMock.agentEvidence.count.mockResolvedValue(5);

    // 1st call: DB queried
    const rows1 = await getLeaderboard({ limit: 20 });
    expect(rows1).toHaveLength(1);
    expect(prismaMock.agentEvidence.groupBy).toHaveBeenCalledTimes(1);

    // 2nd call immediately after: cached hit (no new DB groupBy query)
    const rows2 = await getLeaderboard({ limit: 20 });
    expect(rows2).toHaveLength(1);
    expect(rows2[0].agent_commitment_hash).toBe("a".repeat(64));
    expect(prismaMock.agentEvidence.groupBy).toHaveBeenCalledTimes(1);
  });

  it("refreshes data when invalidateLeaderboardCache is called", async () => {
    prismaMock.agentEvidence.groupBy.mockResolvedValue([
      {
        agentIdentityCommitment: "b".repeat(64),
        _count: { _all: 3 },
        _max: { observedAt: new Date("2026-08-20T00:00:00.000Z") },
      },
    ]);
    prismaMock.agentEvidence.findMany.mockResolvedValue([]);
    prismaMock.agentEvidence.count.mockResolvedValue(2);

    await getLeaderboard({ limit: 20 });
    expect(prismaMock.agentEvidence.groupBy).toHaveBeenCalledTimes(1);

    invalidateLeaderboardCache();

    await getLeaderboard({ limit: 20 });
    expect(prismaMock.agentEvidence.groupBy).toHaveBeenCalledTimes(2);
  });
});
