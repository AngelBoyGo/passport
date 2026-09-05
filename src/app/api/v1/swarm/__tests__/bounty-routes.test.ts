import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sign, getPublicKey } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { POST as bountiesPost, GET as bountiesGet } from "../bounties/route";
import { POST as claimPost } from "../bounties/[id]/claim/route";
import { POST as submitPost } from "../bounties/[id]/submit/route";
import { POST as completePost } from "../bounties/[id]/complete/route";
import { computeSwarmDigest } from "@/lib/swarm/swarm-service";
import { prisma } from "@/lib/db";

const creatorPrivKey = "1111111111111111111111111111111111111111111111111111111111111111";
const creatorPubKey = bytesToHex(getPublicKey(hexToBytes(creatorPrivKey)));
const creatorCommitment = "c".repeat(64);

const workerPrivKey = "2222222222222222222222222222222222222222222222222222222222222222";
const workerPubKey = bytesToHex(getPublicKey(hexToBytes(workerPrivKey)));
const workerCommitment = "w".repeat(64);

describe("Swarm Bounty API Routes (Integration)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(prisma.agentWallet, "findUnique").mockResolvedValue({
      id: "w_1",
      subjectCommitment: creatorCommitment,
      balance: 100,
      staked: 0,
      earnedTotal: 0,
      spentTotal: 0,
    } as any);

    vi.spyOn(prisma.agentWallet, "update").mockResolvedValue({ balance: 60 } as any);
    vi.spyOn(prisma.agentWallet, "upsert").mockResolvedValue({ balance: 39 } as any);
  });

  it("POST /api/v1/swarm/bounties creates an open bounty", async () => {
    const title = "Decompile sandbox probe";
    const description = "Inspect probe signature";
    const rewardAngel = 40;
    const digest = computeSwarmDigest({ title, description, rewardAngel });
    const signature = bytesToHex(sign(utf8ToBytes(digest), hexToBytes(creatorPrivKey)));

    vi.spyOn(prisma.swarmBounty, "create").mockResolvedValueOnce({
      id: "bty_100",
      creatorCommitment,
      workerCommitment: null,
      title,
      description,
      bountyType: "SECURITY_AUDIT",
      rewardAngel,
      feeAngel: 1,
      status: "OPEN",
      deliverableDigest: null,
      deliverableUrl: null,
      workerSignature: null,
      claimExpiresAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const req = new NextRequest("http://localhost/api/v1/swarm/bounties", {
      method: "POST",
      body: JSON.stringify({
        creator_commitment: creatorCommitment,
        title,
        description,
        bounty_type: "SECURITY_AUDIT",
        reward_angel: rewardAngel,
        signature,
        public_key: creatorPubKey,
      }),
    });

    const res = await bountiesPost(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.bounty.id).toBe("bty_100");
  });

  it("GET /api/v1/swarm/bounties returns open bounties", async () => {
    vi.spyOn(prisma.swarmBounty, "findMany").mockResolvedValueOnce([
      {
        id: "bty_100",
        creatorCommitment,
        workerCommitment: null,
        title: "Test",
        description: "Desc",
        bountyType: "GENERAL",
        rewardAngel: 10,
        feeAngel: 1,
        status: "OPEN",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ]);

    const req = new NextRequest("http://localhost/api/v1/swarm/bounties?status=OPEN");
    const res = await bountiesGet(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(1);
    expect(json.bounties[0].status).toBe("OPEN");
  });

  it("POST /api/v1/swarm/bounties/:id/claim claims the bounty", async () => {
    const claimDigest = computeSwarmDigest({ action: "claim", bountyId: "bty_100" });
    const signature = bytesToHex(sign(utf8ToBytes(claimDigest), hexToBytes(workerPrivKey)));

    const existing = {
      id: "bty_100",
      creatorCommitment,
      workerCommitment: null,
      title: "Test",
      description: "Desc",
      bountyType: "GENERAL",
      rewardAngel: 10,
      feeAngel: 1,
      status: "OPEN",
    };

    vi.spyOn(prisma.swarmBounty, "findUnique").mockResolvedValueOnce(existing as any);
    vi.spyOn(prisma.swarmBounty, "update").mockResolvedValueOnce({
      ...existing,
      workerCommitment,
      status: "CLAIMED",
      claimExpiresAt: new Date(Date.now() + 7200000),
    } as any);

    const req = new NextRequest("http://localhost/api/v1/swarm/bounties/bty_100/claim", {
      method: "POST",
      body: JSON.stringify({
        worker_commitment: workerCommitment,
        signature,
        public_key: workerPubKey,
      }),
    });

    const res = await claimPost(req, { params: Promise.resolve({ id: "bty_100" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.bounty.status).toBe("CLAIMED");
  });
});
