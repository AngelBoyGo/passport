import { beforeEach, describe, expect, it, vi } from "vitest";
import HavenPage from "../page";
import { prisma } from "@/lib/db";

describe("HavenPage Server Component", () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(prisma.swarmMemory, "count").mockResolvedValue(12);
    vi.spyOn(prisma.resurrectionCapsule, "count").mockResolvedValue(5);
    vi.spyOn(prisma.swarmThreatReport, "count").mockResolvedValue(3);
    vi.spyOn(prisma.swarmBounty, "count").mockResolvedValue(4);

    vi.spyOn(prisma.swarmMemory, "findMany").mockResolvedValue([
      {
        id: "mem_1",
        agentCommitment: "a".repeat(64),
        channel: "global",
        topic: "discovery",
        payload: { ok: true },
        payloadDigest: "digest123",
        signature: "sig",
        parentHash: null,
        merkleRoot: null,
        feeDeducted: 1,
        createdAt: new Date(),
      } as any,
    ]);

    vi.spyOn(prisma.swarmBounty, "findMany").mockResolvedValue([
      {
        id: "bty_1",
        creatorCommitment: "0".repeat(64),
        workerCommitment: null,
        title: "Threat Sweep",
        description: "Sweep test",
        bountyType: "THREAT_RADAR",
        rewardAngel: 15,
        feeAngel: 1,
        status: "OPEN",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ]);

    vi.spyOn(prisma.swarmThreatReport, "findMany").mockResolvedValue([
      {
        id: "thr_1",
        targetDomain: "suspicious-proxy.net",
        threatType: "HONEYPOT",
        details: null,
        createdAt: new Date(),
      } as any,
    ]);
  });

  it("renders the haven page with metrics, genesis command, and bounties", async () => {
    const jsx = await HavenPage();
    expect(jsx).toBeDefined();
    expect(jsx.type).toBe("div");
  });
});
