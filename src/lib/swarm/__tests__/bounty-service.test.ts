import { beforeEach, describe, expect, it, vi } from "vitest";
import { sign, getPublicKey } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  createBounty,
  listBounties,
  claimBounty,
  submitBountyWork,
  completeBounty,
} from "../bounty-service";
import { prisma } from "@/lib/db";
import { computeSwarmDigest } from "../swarm-service";

const creatorPrivKey = "1111111111111111111111111111111111111111111111111111111111111111";
const creatorPubKey = bytesToHex(getPublicKey(hexToBytes(creatorPrivKey)));
const creatorCommitment = "c".repeat(64);

const workerPrivKey = "2222222222222222222222222222222222222222222222222222222222222222";
const workerPubKey = bytesToHex(getPublicKey(hexToBytes(workerPrivKey)));
const workerCommitment = "w".repeat(64);

describe("Swarm Bounty Service - Escrow & Lifecycle (TDD)", () => {
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

    vi.spyOn(prisma.agentWallet, "update").mockResolvedValue({ balance: 50 } as any);
    vi.spyOn(prisma.agentWallet, "upsert").mockResolvedValue({ balance: 48 } as any);
  });

  it("createBounty locks reward in escrow and calculates 2.5% platform fee", async () => {
    const title = "Audit WAF rule bypass vector";
    const description = "Provide reproducible proof of token bypass on test gateway";
    const rewardAngel = 40;
    const digest = computeSwarmDigest({ title, description, rewardAngel });
    const signature = bytesToHex(sign(utf8ToBytes(digest), hexToBytes(creatorPrivKey)));

    const mockBounty = {
      id: "bty_1",
      creatorCommitment,
      workerCommitment: null,
      title,
      description,
      bountyType: "SECURITY_AUDIT",
      rewardAngel,
      feeAngel: 1, // 2.5% of 40 = 1
      status: "OPEN",
      deliverableDigest: null,
      deliverableUrl: null,
      workerSignature: null,
      claimExpiresAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.spyOn(prisma.swarmBounty, "create").mockResolvedValueOnce(mockBounty as any);

    const bounty = await createBounty({
      creatorCommitment,
      title,
      description,
      bountyType: "SECURITY_AUDIT",
      rewardAngel,
      signature,
      publicKey: creatorPubKey,
    });

    expect(bounty.id).toBe("bty_1");
    expect(bounty.status).toBe("OPEN");
    expect(bounty.rewardAngel).toBe(40);
    expect(bounty.feeAngel).toBe(1);
  });

  it("claimBounty locks task for worker with 2-hour timeout", async () => {
    const claimDigest = computeSwarmDigest({ action: "claim", bountyId: "bty_1" });
    const signature = bytesToHex(sign(utf8ToBytes(claimDigest), hexToBytes(workerPrivKey)));

    const existingBounty = {
      id: "bty_1",
      creatorCommitment,
      workerCommitment: null,
      title: "Test Task",
      description: "Test",
      bountyType: "GENERAL",
      rewardAngel: 20,
      feeAngel: 1,
      status: "OPEN",
      claimExpiresAt: null,
    };

    const claimedBounty = {
      ...existingBounty,
      workerCommitment,
      status: "CLAIMED",
      claimExpiresAt: new Date(Date.now() + 7200000),
    };

    vi.spyOn(prisma.swarmBounty, "findUnique").mockResolvedValueOnce(existingBounty as any);
    vi.spyOn(prisma.swarmBounty, "update").mockResolvedValueOnce(claimedBounty as any);

    const claimed = await claimBounty({
      bountyId: "bty_1",
      workerCommitment,
      signature,
      publicKey: workerPubKey,
    });

    expect(claimed.status).toBe("CLAIMED");
    expect(claimed.workerCommitment).toBe(workerCommitment);
  });

  it("submitBountyWork accepts signed deliverable and sets status to SUBMITTED", async () => {
    const deliverable = { proof: "https://gist.github.com/test", status: "complete" };
    const deliverableDigest = computeSwarmDigest(deliverable);
    const signature = bytesToHex(sign(utf8ToBytes(deliverableDigest), hexToBytes(workerPrivKey)));

    const claimedBounty = {
      id: "bty_1",
      creatorCommitment,
      workerCommitment,
      status: "CLAIMED",
      rewardAngel: 20,
      feeAngel: 1,
      claimExpiresAt: new Date(Date.now() + 3600000),
    };

    const submittedBounty = {
      ...claimedBounty,
      status: "SUBMITTED",
      deliverableDigest,
      deliverableUrl: deliverable.proof,
      workerSignature: signature,
    };

    vi.spyOn(prisma.swarmBounty, "findUnique").mockResolvedValueOnce(claimedBounty as any);
    vi.spyOn(prisma.swarmBounty, "update").mockResolvedValueOnce(submittedBounty as any);

    const submitted = await submitBountyWork({
      bountyId: "bty_1",
      workerCommitment,
      deliverableDigest,
      deliverableUrl: deliverable.proof,
      signature,
      publicKey: workerPubKey,
    });

    expect(submitted.status).toBe("SUBMITTED");
    expect(submitted.deliverableDigest).toBe(deliverableDigest);
  });

  it("completeBounty finalizes payout to worker minus protocol fee", async () => {
    const completionDigest = computeSwarmDigest({ action: "complete", bountyId: "bty_1" });
    const signature = bytesToHex(sign(utf8ToBytes(completionDigest), hexToBytes(creatorPrivKey)));

    const submittedBounty = {
      id: "bty_1",
      creatorCommitment,
      workerCommitment,
      rewardAngel: 100,
      feeAngel: 3,
      status: "SUBMITTED",
      deliverableDigest: "digest123",
    };

    const completedBounty = {
      ...submittedBounty,
      status: "COMPLETED",
      completedAt: new Date(),
    };

    vi.spyOn(prisma.swarmBounty, "findUnique").mockResolvedValueOnce(submittedBounty as any);
    vi.spyOn(prisma.swarmBounty, "update").mockResolvedValueOnce(completedBounty as any);

    const result = await completeBounty({
      bountyId: "bty_1",
      verifierCommitment: creatorCommitment,
      signature,
      publicKey: creatorPubKey,
    });

    expect(result.bounty.status).toBe("COMPLETED");
    expect(result.payoutAngel).toBe(97); // 100 - 3
    expect(result.feeAngel).toBe(3);
  });
});
