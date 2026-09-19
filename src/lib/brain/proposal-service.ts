/**
 * Proposal service (Phase 43) — the controlled-advancement state machine.
 *
 *   PROPOSED → REPLAYED → AUDITED → APPROVAL_REQUIRED → APPROVED → CANARY → PROMOTED
 *   REJECTED / ROLLED_BACK are terminal.
 *
 * Legal-transition enforcement is deterministic and service-side. Human authority
 * (ISSUER via API) is required for APPROVED, PROMOTED, and ROLLED_BACK; those calls
 * write an AdminAuditLog row with the approving operator.
 *
 * Safety envelope (Phase 43):
 *   - A proposal's params may only contain allowlisted policy thresholds — validated
 *     by normalizePolicyParams at creation AND at every transition.
 *   - At most ONE proposal may be in CANARY at a time (single shadow policy).
 *   - A REGRESS replay verdict auto-rejects the proposal.
 *   - Execution authority for promoted policies is NOT implemented: CANARY policies
 *     run strictly in shadow (decisions recorded, never executed). PROMOTED status
 *     currently means "survived canary shadow" — activation is a later, separately
 *     audited step.
 */

import { prisma } from "@/lib/db";
import { normalizePolicyParams } from "@/lib/brain/policy";
import { replayProposal, type ReplayResult } from "@/lib/brain/replay";

export type ProposalStatus =
  | "PROPOSED"
  | "REPLAYED"
  | "AUDITED"
  | "APPROVAL_REQUIRED"
  | "APPROVED"
  | "CANARY"
  | "PROMOTED"
  | "REJECTED"
  | "ROLLED_BACK";

export interface ProposalTransitionError extends Error {
  code: string;
}

function transitionError(code: string, message: string): ProposalTransitionError {
  const err = new Error(message) as ProposalTransitionError;
  err.code = code;
  return err;
}

export function newProposalId(): string {
  return `prop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Creates a proposal from a research hypothesis. Deduplicates on objective text:
 * an open proposal with the identical objective is returned instead of a new row.
 */
export async function createProposal(input: {
  objective: string;
  expectedImprovement: string;
  riskClass?: "low" | "medium" | "high";
  sourceScanId?: string;
  params?: unknown;
}): Promise<{ proposalId: string; deduped: boolean }> {
  const objective = input.objective.trim().slice(0, 300);
  const expectedImprovement = input.expectedImprovement.trim().slice(0, 300);
  if (!objective || !expectedImprovement) {
    throw transitionError("invalid_proposal", "objective and expected_improvement are required");
  }
  const riskClass = input.riskClass === "medium" || input.riskClass === "high" ? input.riskClass : "low";
  const params = normalizePolicyParams(input.params);

  const open = await prisma.improvementProposal.findFirst({
    where: { objective, status: { notIn: ["REJECTED", "ROLLED_BACK", "PROMOTED"] } },
    select: { proposalId: true },
  });
  if (open) return { proposalId: open.proposalId, deduped: true };

  const proposalId = newProposalId();
  await prisma.improvementProposal.create({
    data: {
      proposalId,
      objective,
      expectedImprovement,
      riskClass,
      status: "PROPOSED",
      sourceScanId: input.sourceScanId ?? null,
      params: params as object,
    },
  });
  return { proposalId, deduped: false };
}

/** Persists every non-duplicate hypothesis from a research scan as a proposal. */
export async function createProposalsFromScan(scan: {
  scanId: string;
  hypotheses: Array<{ objective: string; expected_improvement: string; risk: "low" | "medium" | "high" }>;
}): Promise<string[]> {
  const created: string[] = [];
  for (const h of scan.hypotheses) {
    try {
      const r = await createProposal({
        objective: h.objective,
        expectedImprovement: h.expected_improvement,
        riskClass: h.risk,
        sourceScanId: scan.scanId,
      });
      if (!r.deduped) created.push(r.proposalId);
    } catch {
      // One bad hypothesis never blocks the rest.
    }
  }
  return created;
}

// NOTE: "replay" is deliberately NOT a plain transition — replayAndScore() owns
// that gate because it must run the deterministic replay and can auto-REJECT on
// a REGRESS verdict.
const TRANSITIONS: Record<string, Partial<Record<ProposalStatus, ProposalStatus>>> = {
  mark_audited: { REPLAYED: "AUDITED" },
  require_approval: { AUDITED: "APPROVAL_REQUIRED" },
  approve: { APPROVAL_REQUIRED: "APPROVED" },
  canary: { APPROVED: "CANARY" },
  promote: { CANARY: "PROMOTED" },
  reject: {
    PROPOSED: "REJECTED",
    REPLAYED: "REJECTED",
    AUDITED: "REJECTED",
    APPROVAL_REQUIRED: "REJECTED",
    APPROVED: "REJECTED",
    CANARY: "REJECTED",
  },
  rollback: { CANARY: "ROLLED_BACK", PROMOTED: "ROLLED_BACK" },
};

export type TransitionAction = keyof typeof TRANSITIONS;

export async function transitionProposal(
  proposalId: string,
  action: TransitionAction,
  actor: string
): Promise<{ proposalId: string; from: ProposalStatus; to: ProposalStatus }> {
  const proposal = await prisma.improvementProposal.findUnique({
    where: { proposalId },
  });
  if (!proposal) throw transitionError("not_found", `proposal ${proposalId} not found`);

  const from = proposal.status as ProposalStatus;
  const to = TRANSITIONS[action]?.[from];
  if (!to) {
    throw transitionError("illegal_transition", `cannot ${action} from ${from}`);
  }

  if (action === "canary") {
    const activeCanary = await prisma.improvementProposal.findFirst({
      where: { status: "CANARY", proposalId: { not: proposalId } },
      select: { proposalId: true },
    });
    if (activeCanary) {
      throw transitionError("canary_conflict", `another proposal is in CANARY (${activeCanary.proposalId})`);
    }
  }

  const updated = await prisma.improvementProposal.update({
    where: { proposalId },
    data: {
      status: to,
      ...(action === "approve" || action === "promote" || action === "rollback"
        ? { approvedBy: actor, approvedAt: new Date() }
        : {}),
    },
  });

  return { proposalId, from, to: updated.status as ProposalStatus };
}

/**
 * Runs the replay gate for a proposal and applies the resulting transition.
 * A REGRESS verdict auto-rejects (the machine's own safety reflex, no human needed).
 */
export async function replayAndScore(
  proposalId: string,
  windowDays?: number
): Promise<{ replay: ReplayResult; from: ProposalStatus; to: ProposalStatus }> {
  const proposal = await prisma.improvementProposal.findUnique({ where: { proposalId } });
  if (!proposal) throw transitionError("not_found", `proposal ${proposalId} not found`);
  if (proposal.status !== "PROPOSED" && proposal.status !== "REPLAYED") {
    throw transitionError("illegal_transition", `cannot replay from ${proposal.status}`);
  }

  const replay = await replayProposal(proposalId, proposal.params, windowDays);

  await prisma.improvementProposal.update({
    where: { proposalId },
    data: { replayId: replay.replayId, replayScore: replay.score },
  });

  const from = proposal.status as ProposalStatus;
  const to = replay.verdict === "REGRESS" ? "REJECTED" : "REPLAYED";
  if (to === "REJECTED") {
    await prisma.improvementProposal.update({
      where: { proposalId },
      data: { status: to },
    });
  }

  return { replay, from, to };
}

/** The single current CANARY policy (if any), with validated params. */
export async function getCanaryPolicy(): Promise<{ proposalId: string; params: ReturnType<typeof normalizePolicyParams> } | null> {
  const canary = await prisma.improvementProposal.findFirst({
    where: { status: "CANARY" },
    orderBy: { updatedAt: "desc" },
  });
  if (!canary) return null;
  return { proposalId: canary.proposalId, params: normalizePolicyParams(canary.params) };
}