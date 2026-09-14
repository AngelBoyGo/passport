/**
 * Compute dispute arbitration (Phase 35).
 *
 * When a delivered compute purchase is contested, a quorum of STAKED, independent juror agents
 * votes (each vote is an Ed25519 signature over the dispute + verdict). At quorum the majority
 * outcome is executed against the escrow — release (pay provider) or refund (make buyer whole).
 * Ties resolve to REFUND (buyer-protective). Staking is the Sybil/collusion cost.
 */

import { verifyPinnedSignature } from "@/lib/auth/verifyPinnedSignature";
import "@/lib/receipt/crypto";
import { canonicalJson } from "@/lib/receipt/canonical";
import { prisma } from "@/lib/db";
import { releaseCompute, refundCompute } from "./compute-marketplace";

export const DISPUTE_QUORUM = 3;
/** ANGEL paid to each majority juror out of the escrowed amount at resolution. */
export const JUROR_FEE_ANGEL = 1;
/** ANGEL forfeited from each minority juror's staked bond at resolution. */
export const JUROR_SLASH_ANGEL = 1;

export type DisputeVote = "RELEASE" | "REFUND";

export type DisputeResult =
  | { ok: true; disputeId: string; status: string; votes?: number; resolution?: DisputeVote | null }
  | { ok: false; code: string; error: string };

export function canonicalVote(input: { disputeId: string; vote: string }): string {
  return canonicalJson({ dispute_id: input.disputeId, vote: input.vote });
}

/** Buyer or provider opens a dispute over a DELIVERED purchase. */
export async function openDispute(input: {
  disputeId: string;
  purchaseId: string;
  openedBy: string;
  reason: string;
}): Promise<DisputeResult> {
  const purchaseId = input.purchaseId.trim();
  const openedBy = input.openedBy.toLowerCase();
  const disputeId = input.disputeId.trim();

  const purchase = await prisma.computePurchase.findUnique({ where: { purchaseId } });
  if (!purchase) return { ok: false, code: "purchase_not_found", error: "Purchase not found" };
  if (purchase.status !== "DELIVERED") {
    return { ok: false, code: "invalid_state", error: "Only DELIVERED purchases can be disputed" };
  }
  if (openedBy !== purchase.buyerCommitment && openedBy !== purchase.providerCommitment) {
    return { ok: false, code: "not_party", error: "Only a party to the purchase may open a dispute" };
  }
  if (!input.reason || input.reason.trim().length < 4) {
    return { ok: false, code: "invalid_reason", error: "reason is required" };
  }

  const existing = await prisma.computeDispute.findFirst({
    where: { purchaseId, status: "OPEN" },
  });
  if (existing) return { ok: true, disputeId: existing.disputeId, status: "OPEN" };

  const dispute = await prisma.computeDispute.create({
    data: { disputeId, purchaseId, openedBy, reason: input.reason.trim(), status: "OPEN" },
  });
  return { ok: true, disputeId: dispute.disputeId, status: "OPEN" };
}

/**
 * A staked, independent, enrolled juror casts a signed vote. On reaching quorum the majority
 * outcome is executed against the escrow (ties → REFUND).
 */
export async function castDisputeVote(input: {
  disputeId: string;
  jurorCommitment: string;
  vote: DisputeVote;
  signature: string;
}): Promise<DisputeResult> {
  const disputeId = input.disputeId.trim();
  const juror = input.jurorCommitment.toLowerCase();
  const vote = input.vote;

  const dispute = await prisma.computeDispute.findUnique({ where: { disputeId } });
  if (!dispute) return { ok: false, code: "dispute_not_found", error: "Dispute not found" };
  if (dispute.status !== "OPEN") {
    return { ok: false, code: "dispute_closed", error: `Dispute is ${dispute.status}` };
  }
  if (vote !== "RELEASE" && vote !== "REFUND") {
    return { ok: false, code: "invalid_vote", error: "vote must be RELEASE or REFUND" };
  }

  const purchase = await prisma.computePurchase.findUnique({ where: { purchaseId: dispute.purchaseId } });
  if (!purchase) return { ok: false, code: "purchase_not_found", error: "Purchase not found" };
  if (juror === purchase.buyerCommitment || juror === purchase.providerCommitment) {
    return { ok: false, code: "not_independent", error: "Juror must not be a party to the purchase" };
  }

  const wallet = await prisma.agentWallet.findUnique({ where: { subjectCommitment: juror } });
  if (!wallet || wallet.staked <= 0) {
    return { ok: false, code: "not_staked", error: "Juror must be a staked agent" };
  }
  const enrollment = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: juror },
    select: { publicKey: true, status: true },
  });
  if (!enrollment || enrollment.status !== "ISSUED") {
    return { ok: false, code: "not_enrolled", error: "Juror is not enrolled" };
  }
  if (!/^[0-9a-f]{128}$/i.test(input.signature)) {
    return { ok: false, code: "invalid_signature", error: "signature must be 128-hex" };
  }

  const check = await verifyPinnedSignature({
    pinnedKey: enrollment.publicKey,
    signatureHex: input.signature,
    signPayload: canonicalVote({ disputeId, vote }),
    context: "agent-economy.dispute.vote",
    commitment: juror,
  });
  if (!check.valid) return { ok: false, code: "invalid_signature", error: "vote signature verification failed" };

  // One vote per juror (unique). A duplicate is idempotent.
  try {
    await prisma.computeDisputeVote.create({
      data: { disputeId, jurorCommitment: juror, vote, signature: input.signature },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      const count = await prisma.computeDisputeVote.count({ where: { disputeId } });
      return { ok: true, disputeId, status: "OPEN", votes: count };
    }
    throw err;
  }

  const votes = await prisma.computeDisputeVote.findMany({ where: { disputeId } });
  if (votes.length < DISPUTE_QUORUM) {
    return { ok: true, disputeId, status: "OPEN", votes: votes.length };
  }

  // Quorum reached: majority outcome, ties → REFUND.
  const releaseVotes = votes.filter((v) => v.vote === "RELEASE").length;
  const refundVotes = votes.filter((v) => v.vote === "REFUND").length;
  const resolution: DisputeVote = releaseVotes > refundVotes ? "RELEASE" : "REFUND";

  // Juror incentives: reward the majority out of escrow; slash the minority's staked bond.
  const majority = votes.filter((v) => v.vote === resolution);
  const minority = votes.filter((v) => v.vote !== resolution);
  const settlement = {
    jurorRewards: majority.map((v) => ({ commitment: v.jurorCommitment, amount: JUROR_FEE_ANGEL })),
    slashes: minority.map((v) => ({ commitment: v.jurorCommitment, amount: JUROR_SLASH_ANGEL })),
  };

  const outcome =
    resolution === "RELEASE"
      ? await releaseCompute({
          purchaseId: dispute.purchaseId,
          actorCommitment: purchase.buyerCommitment,
          isIssuer: true,
          force: true,
          settlement,
        })
      : await refundCompute({
          purchaseId: dispute.purchaseId,
          actorCommitment: purchase.buyerCommitment,
          isIssuer: true,
          force: true,
          settlement,
        });

  await prisma.computeDispute.update({
    where: { disputeId },
    data: { status: "RESOLVED", resolution, resolvedAt: new Date() },
  });

  if (!outcome.ok) {
    return { ok: false, code: outcome.code, error: `Arbitration outcome failed: ${outcome.error}` };
  }
  return { ok: true, disputeId, status: "RESOLVED", votes: votes.length, resolution };
}

export async function getDispute(disputeId: string) {
  const dispute = await prisma.computeDispute.findUnique({ where: { disputeId: disputeId.trim() } });
  if (!dispute) return null;
  const votes = await prisma.computeDisputeVote.findMany({
    where: { disputeId: dispute.disputeId },
    select: { jurorCommitment: true, vote: true, createdAt: true },
  });
  return { ...dispute, votes };
}

/**
 * Aggregated verifier reward pool accounting — juror lifetime stats computed
 * from existing vote data. No separate table; pure aggregation.
 */
export async function getJurorRewardStats(
  jurorCommitment: string
): Promise<{
  totalDisputesServed: number;
  majorityVotes: number;
  minorityVotes: number;
  totalRewardsEarned: number;
  totalSlashApplied: number;
  netEarnings: number;
  alignmentRatio: number;
}> {
  const juror = jurorCommitment.toLowerCase();

  const allVotes = await prisma.computeDisputeVote.findMany({
    where: { jurorCommitment: juror },
  });

  const resolvedDisputeIds = allVotes.map((v) => v.disputeId);
  const resolved = new Set<string>();
  const resolutionByDispute = new Map<string, string>();

  if (resolvedDisputeIds.length > 0) {
    const disputes = await prisma.computeDispute.findMany({
      where: { disputeId: { in: resolvedDisputeIds }, status: "RESOLVED", resolution: { not: null } },
    });
    for (const d of disputes) {
      resolved.add(d.disputeId);
      resolutionByDispute.set(d.disputeId, d.resolution!);
    }
  }

  let majorityVotes = 0;
  let minorityVotes = 0;

  for (const v of allVotes) {
    const resolution = resolutionByDispute.get(v.disputeId);
    if (!resolution) continue;
    if (v.vote === resolution) majorityVotes++;
    else minorityVotes++;
  }

  const total = majorityVotes + minorityVotes;
  const rewards = majorityVotes * JUROR_FEE_ANGEL;
  const slashes = minorityVotes * JUROR_SLASH_ANGEL;

  return {
    totalDisputesServed: allVotes.length,
    majorityVotes,
    minorityVotes,
    totalRewardsEarned: rewards,
    totalSlashApplied: slashes,
    netEarnings: rewards - slashes,
    alignmentRatio: total > 0 ? Math.round((majorityVotes / total) * 1000) / 1000 : 0,
  };
}

export async function listJurorRewardPool(
  limit = 20
): Promise<Array<{ jurorCommitment: string; disputesServed: number; netEarnings: number }>> {
  const groups = await prisma.computeDisputeVote.groupBy({
    by: ["jurorCommitment"],
    _count: { jurorCommitment: true },
    orderBy: { _count: { jurorCommitment: "desc" } },
    take: Math.min(Math.max(limit, 1), 100),
  });

  return Promise.all(
    groups.map(async (g) => {
      const stats = await getJurorRewardStats(g.jurorCommitment);
      return {
        jurorCommitment: g.jurorCommitment,
        disputesServed: stats.totalDisputesServed,
        netEarnings: stats.netEarnings,
      };
    })
  );
}
