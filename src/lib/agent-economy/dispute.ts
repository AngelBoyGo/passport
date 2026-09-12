/**
 * Compute dispute arbitration (Phase 35).
 *
 * When a delivered compute purchase is contested, a quorum of STAKED, independent juror agents
 * votes (each vote is an Ed25519 signature over the dispute + verdict). At quorum the majority
 * outcome is executed against the escrow — release (pay provider) or refund (make buyer whole).
 * Ties resolve to REFUND (buyer-protective). Staking is the Sybil/collusion cost.
 */

import { verify } from "@noble/ed25519";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";
import { prisma } from "@/lib/db";
import { canonicalJson } from "@/lib/receipt/canonical";
import { releaseCompute, refundCompute } from "./compute-marketplace";

export const DISPUTE_QUORUM = 3;

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

  let valid = false;
  try {
    valid = await verify(
      hexToBytes(input.signature),
      utf8ToBytes(canonicalVote({ disputeId, vote })),
      hexToBytes(enrollment.publicKey)
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, code: "invalid_signature", error: "vote signature verification failed" };

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

  const outcome =
    resolution === "RELEASE"
      ? await releaseCompute({
          purchaseId: dispute.purchaseId,
          actorCommitment: purchase.buyerCommitment,
          isIssuer: true,
          force: true,
        })
      : await refundCompute({
          purchaseId: dispute.purchaseId,
          actorCommitment: purchase.buyerCommitment,
          isIssuer: true,
          force: true,
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
