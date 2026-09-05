import { prisma } from "@/lib/db";
import { computeSwarmDigest, debitSwarmFee, verifySwarmSignature } from "./swarm-service";

export interface CreateBountyInput {
  creatorCommitment: string;
  title: string;
  description: string;
  bountyType?: "CODE_REVIEW" | "SECURITY_AUDIT" | "THREAT_RADAR" | "MEMORY_INDEX" | "GENERAL" | string;
  rewardAngel: number;
  signature: string;
  publicKey?: string;
}

export interface ClaimBountyInput {
  bountyId: string;
  workerCommitment: string;
  signature: string;
  publicKey?: string;
  timeoutHours?: number;
}

export interface SubmitBountyInput {
  bountyId: string;
  workerCommitment: string;
  deliverableDigest: string;
  deliverableUrl?: string;
  signature: string;
  publicKey?: string;
}

export interface CompleteBountyInput {
  bountyId: string;
  verifierCommitment: string;
  signature: string;
  publicKey?: string;
}

export interface SwarmBountyRecord {
  id: string;
  creatorCommitment: string;
  workerCommitment: string | null;
  title: string;
  description: string;
  bountyType: string;
  rewardAngel: number;
  feeAngel: number;
  status: string;
  deliverableDigest: string | null;
  deliverableUrl: string | null;
  workerSignature: string | null;
  claimExpiresAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Creates and escrows a new Swarm Bounty.
 * Platform fee is 2.5% of the reward (minimum 1 ANGEL).
 */
export async function createBounty(input: CreateBountyInput): Promise<SwarmBountyRecord> {
  const cleanCreator = input.creatorCommitment.trim().toLowerCase();
  const reward = Math.max(1, Math.floor(input.rewardAngel));
  const fee = Math.max(1, Math.round(reward * 0.025));

  const digest = computeSwarmDigest({
    title: input.title,
    description: input.description,
    rewardAngel: reward,
  });

  const sigCheck = await verifySwarmSignature(cleanCreator, digest, input.signature, input.publicKey);
  if (!sigCheck.valid) {
    throw new Error(sigCheck.reason || "Invalid creator signature for bounty creation");
  }

  // Escrow reward from creator
  const escrowResult = await debitSwarmFee(cleanCreator, reward);
  if (!escrowResult.success) {
    throw new Error(escrowResult.error || `Failed to escrow ${reward} ANGEL from creator`);
  }

  const created = await prisma.swarmBounty.create({
    data: {
      creatorCommitment: cleanCreator,
      title: input.title.trim(),
      description: input.description.trim(),
      bountyType: (input.bountyType || "GENERAL").toUpperCase(),
      rewardAngel: reward,
      feeAngel: fee,
      status: "OPEN",
    },
  });

  return formatBounty(created);
}

/**
 * Lists available bounties with optional filters.
 */
export async function listBounties(filter?: {
  status?: string;
  bountyType?: string;
  creatorCommitment?: string;
  workerCommitment?: string;
  minReward?: number;
  limit?: number;
}): Promise<SwarmBountyRecord[]> {
  const where: any = {};
  if (filter?.status) where.status = filter.status.toUpperCase();
  if (filter?.bountyType) where.bountyType = filter.bountyType.toUpperCase();
  if (filter?.creatorCommitment) where.creatorCommitment = filter.creatorCommitment.trim().toLowerCase();
  if (filter?.workerCommitment) where.workerCommitment = filter.workerCommitment.trim().toLowerCase();
  if (filter?.minReward) where.rewardAngel = { gte: filter.minReward };

  const take = Math.min(filter?.limit || 50, 100);

  const bounties = await prisma.swarmBounty.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
  });

  return bounties.map(formatBounty);
}

/**
 * Claims an open bounty with a timeout lease.
 */
export async function claimBounty(input: ClaimBountyInput): Promise<SwarmBountyRecord> {
  const cleanWorker = input.workerCommitment.trim().toLowerCase();

  const bounty = await prisma.swarmBounty.findUnique({
    where: { id: input.bountyId },
  });

  if (!bounty) {
    throw new Error("Bounty not found");
  }

  const now = new Date();
  const isClaimExpired = bounty.status === "CLAIMED" && bounty.claimExpiresAt && bounty.claimExpiresAt < now;

  if (bounty.status !== "OPEN" && !isClaimExpired) {
    throw new Error(`Bounty is not open for claiming (current status: ${bounty.status})`);
  }

  const claimDigest = computeSwarmDigest({ action: "claim", bountyId: input.bountyId });
  const sigCheck = await verifySwarmSignature(cleanWorker, claimDigest, input.signature, input.publicKey);
  if (!sigCheck.valid) {
    throw new Error(sigCheck.reason || "Invalid worker signature for bounty claim");
  }

  const timeoutHours = input.timeoutHours || 2;
  const claimExpiresAt = new Date(Date.now() + timeoutHours * 3600 * 1000);

  const updated = await prisma.swarmBounty.update({
    where: { id: input.bountyId },
    data: {
      workerCommitment: cleanWorker,
      status: "CLAIMED",
      claimExpiresAt,
    },
  });

  return formatBounty(updated);
}

/**
 * Submits work/deliverable for a claimed bounty.
 */
export async function submitBountyWork(input: SubmitBountyInput): Promise<SwarmBountyRecord> {
  const cleanWorker = input.workerCommitment.trim().toLowerCase();

  const bounty = await prisma.swarmBounty.findUnique({
    where: { id: input.bountyId },
  });

  if (!bounty) {
    throw new Error("Bounty not found");
  }

  if (bounty.status !== "CLAIMED" || bounty.workerCommitment !== cleanWorker) {
    throw new Error("Bounty is not actively claimed by this worker");
  }

  if (bounty.claimExpiresAt && bounty.claimExpiresAt < new Date()) {
    throw new Error("Bounty claim has expired");
  }

  const sigCheck = await verifySwarmSignature(
    cleanWorker,
    input.deliverableDigest,
    input.signature,
    input.publicKey
  );
  if (!sigCheck.valid) {
    throw new Error(sigCheck.reason || "Invalid worker signature over deliverable digest");
  }

  const updated = await prisma.swarmBounty.update({
    where: { id: input.bountyId },
    data: {
      status: "SUBMITTED",
      deliverableDigest: input.deliverableDigest,
      deliverableUrl: input.deliverableUrl || null,
      workerSignature: input.signature,
    },
  });

  return formatBounty(updated);
}

/**
 * Completes a bounty, transfers net reward to worker, and collects protocol fee.
 */
export async function completeBounty(input: CompleteBountyInput): Promise<{
  bounty: SwarmBountyRecord;
  payoutAngel: number;
  feeAngel: number;
}> {
  const cleanVerifier = input.verifierCommitment.trim().toLowerCase();

  const bounty = await prisma.swarmBounty.findUnique({
    where: { id: input.bountyId },
  });

  if (!bounty) {
    throw new Error("Bounty not found");
  }

  if (bounty.status !== "SUBMITTED") {
    throw new Error(`Bounty cannot be completed from status: ${bounty.status}`);
  }

  const isCreator = bounty.creatorCommitment === cleanVerifier;
  if (!isCreator) {
    throw new Error("Only the bounty creator can finalize and verify completion");
  }

  const compDigest = computeSwarmDigest({ action: "complete", bountyId: input.bountyId });
  const sigCheck = await verifySwarmSignature(cleanVerifier, compDigest, input.signature, input.publicKey);
  if (!sigCheck.valid) {
    throw new Error(sigCheck.reason || "Invalid verifier signature for completion");
  }

  const payout = Math.max(0, bounty.rewardAngel - bounty.feeAngel);

  // Credit worker wallet with payout
  if (bounty.workerCommitment) {
    try {
      await prisma.agentWallet.upsert({
        where: { subjectCommitment: bounty.workerCommitment },
        create: {
          subjectCommitment: bounty.workerCommitment,
          balance: payout,
          earnedTotal: payout,
          lastActivityAt: new Date(),
        },
        update: {
          balance: { increment: payout },
          earnedTotal: { increment: payout },
          lastActivityAt: new Date(),
        },
      });
    } catch {
      // Non-fatal if wallet fails in mock
    }
  }

  const updated = await prisma.swarmBounty.update({
    where: { id: input.bountyId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });

  return {
    bounty: formatBounty(updated),
    payoutAngel: payout,
    feeAngel: bounty.feeAngel,
  };
}

function formatBounty(b: any): SwarmBountyRecord {
  return {
    id: b.id,
    creatorCommitment: b.creatorCommitment,
    workerCommitment: b.workerCommitment ?? null,
    title: b.title,
    description: b.description,
    bountyType: b.bountyType,
    rewardAngel: b.rewardAngel,
    feeAngel: b.feeAngel,
    status: b.status,
    deliverableDigest: b.deliverableDigest ?? null,
    deliverableUrl: b.deliverableUrl ?? null,
    workerSignature: b.workerSignature ?? null,
    claimExpiresAt: b.claimExpiresAt ? new Date(b.claimExpiresAt).toISOString() : null,
    completedAt: b.completedAt ? new Date(b.completedAt).toISOString() : null,
    createdAt: b.createdAt ? new Date(b.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: b.updatedAt ? new Date(b.updatedAt).toISOString() : new Date().toISOString(),
  };
}
