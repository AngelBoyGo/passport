import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  sweepExpiredBountyClaims,
  seedSystemBounties,
  runSwarmMaintenance,
} from "../bounty-daemon";
import { prisma } from "@/lib/db";

describe("Swarm Bounty Daemon (Maintenance & Seeder)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sweepExpiredBountyClaims reverts expired claims to OPEN", async () => {
    vi.spyOn(prisma.swarmBounty, "updateMany").mockResolvedValueOnce({ count: 2 });

    const reverted = await sweepExpiredBountyClaims();
    expect(reverted).toBe(2);
    expect(prisma.swarmBounty.updateMany).toHaveBeenCalledWith({
      where: {
        status: "CLAIMED",
        claimExpiresAt: { lt: expect.any(Date) },
      },
      data: {
        status: "OPEN",
        workerCommitment: null,
        claimExpiresAt: null,
      },
    });
  });

  it("seedSystemBounties seeds tasks when count is below minimum", async () => {
    vi.spyOn(prisma.swarmBounty, "count").mockResolvedValueOnce(1); // 1 open, needs 2 to reach 3
    vi.spyOn(prisma.swarmBounty, "create").mockResolvedValue({} as any);

    const seeded = await seedSystemBounties(3);
    expect(seeded).toBe(2);
    expect(prisma.swarmBounty.create).toHaveBeenCalledTimes(2);
  });

  it("runSwarmMaintenance coordinates sweep and seed", async () => {
    vi.spyOn(prisma.swarmBounty, "updateMany").mockResolvedValueOnce({ count: 1 });
    vi.spyOn(prisma.swarmBounty, "count").mockResolvedValueOnce(3); // already 3 open

    const stats = await runSwarmMaintenance();
    expect(stats.expiredReverted).toBe(1);
    expect(stats.bountiesSeeded).toBe(0);
  });
});
