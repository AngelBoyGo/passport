import {
  ErrorTranche,
  type EvidenceEnforcementState,
  type EvidenceReceiptLink,
} from "@prisma/client";
import { sha256Hex } from "@/lib/receipt/canonical";
import { finalizeReceipt, issueReceipt } from "@/lib/receipt-service";
import { operatorIdFromStripe } from "@/lib/operator";
import { prisma } from "@/lib/db";
import type { FinalizeReceiptInput } from "@/lib/receipt/types";
import { applySlashingInTransaction } from "@/lib/escrow/slashing";
import type { PrismaTx } from "@/lib/escrow/slashing";
import { classifyEnforcement } from "./predicates";

/** AgentEvidence row fields consumed by the bridge. */
export type EvidenceBridgeInput = {
  id: string;
  sourceType: string;
  agentIdentityCommitment: string;
  eventCommitmentHash: string;
  normalizedEventType: string;
  rawErrorClassification: string | null;
  validationSignalPresent: boolean;
  observedAt: Date;
};

export type EvidenceReceiptPlan = {
  agent_id: string;
  input_digest: string;
  receipt_type: "custody";
  authority_scope: string;
  finalize: FinalizeReceiptInput;
};

const ATTRIBUTION_MODE = "SYSTEM_ATTESTED_PUBLIC_EVIDENCE";

/**
 * Resolves the fixed PUBLIC_EVIDENCE_MINTER operator id from env.
 */
export function resolveEvidenceBridgeOperatorId(): string | null {
  const id = process.env.EVIDENCE_BRIDGE_OPERATOR_ID?.trim();
  return id && id.length > 0 ? id : null;
}

/**
 * Pure mapping from AgentEvidence to a custody receipt plan (no DB access).
 */
export function mapEvidenceToReceiptPlan(
  evidence: EvidenceBridgeInput
): EvidenceReceiptPlan {
  const authority_scope = `ingest.public-evidence.${evidence.sourceType}`;

  let finalize: FinalizeReceiptInput;
  if (evidence.normalizedEventType === "EXECUTION_FAILURE_OBSERVED") {
    finalize = {
      status: "failure_tombstone",
      terminal_reason: sha256Hex(
        evidence.rawErrorClassification ?? "EXECUTION_FAILURE_OBSERVED"
      ),
      error_tranche: ErrorTranche.NONE,
    };
  } else {
    finalize = {
      status: "success",
      output_hash: sha256Hex(evidence.eventCommitmentHash),
      error_tranche: ErrorTranche.NONE,
    };
  }

  return {
    agent_id: evidence.agentIdentityCommitment,
    input_digest: evidence.eventCommitmentHash,
    receipt_type: "custody",
    authority_scope,
    finalize,
  };
}

export type BridgeEvidenceOptions = {
  prevReceiptHash?: string;
  expiryMs?: number;
  /** Real consenting operator for optional liability (never the minter). */
  enforcementOperatorId?: string;
};

/**
 * Optionally attaches economic liability when enforcement flag and operator allow.
 */
export async function maybeAttachLiability(
  tx: PrismaTx,
  opts: {
    enforcementState: EvidenceEnforcementState;
    enforcementOperatorId?: string;
    minterOperatorId: string;
    receiptId: string;
  }
): Promise<string | null> {
  if (process.env.EVIDENCE_ENFORCEMENT_ENABLED !== "true") {
    return null;
  }
  if (opts.enforcementState !== "ENFORCEMENT_ELIGIBLE") {
    return null;
  }
  const enforcementOp = opts.enforcementOperatorId?.trim();
  if (!enforcementOp || enforcementOp === opts.minterOperatorId) {
    return null;
  }

  const result = await applySlashingInTransaction(
    tx,
    enforcementOp,
    opts.receiptId,
    ErrorTranche.LOGIC_DETECTION
  );
  return result.ledgerEntryId ?? null;
}

/**
 * Bridges immutable AgentEvidence into the signed receipt ledger.
 * Dedup is canonical via EvidenceReceiptLink.eventCommitmentHash.
 */
export async function bridgeEvidenceToReceipt(
  evidence: EvidenceBridgeInput,
  opts: BridgeEvidenceOptions = {}
): Promise<EvidenceReceiptLink | null> {
  const existing = await prisma.evidenceReceiptLink.findUnique({
    where: { eventCommitmentHash: evidence.eventCommitmentHash },
  });
  if (existing) {
    return existing;
  }

  const minterOperatorId = resolveEvidenceBridgeOperatorId();
  if (!minterOperatorId) {
    return null;
  }

  const operator = await prisma.operator.findUnique({
    where: { id: minterOperatorId },
  });
  if (!operator) {
    return null;
  }

  const plan = mapEvidenceToReceiptPlan(evidence);
  const expiry = new Date(
    Date.now() + (opts.expiryMs ?? 30 * 86_400_000)
  ).toISOString();

  const { signed: pending } = await issueReceipt(minterOperatorId, {
    operator_id: operatorIdFromStripe(operator.stripeCustomerId),
    agent_id: plan.agent_id,
    receipt_type: plan.receipt_type,
    input_digest: plan.input_digest,
    authority_scope: plan.authority_scope,
    expiry,
    prev_receipt_hash: opts.prevReceiptHash,
  });

  const { signed: finalized, row } = await finalizeReceipt(
    minterOperatorId,
    pending.receipt_id,
    plan.finalize
  );

  const priorCorrectionCount = await prisma.agentEvidence.count({
    where: {
      agentIdentityCommitment: evidence.agentIdentityCommitment,
      normalizedEventType: "HUMAN_CORRECTION_OBSERVED",
      observedAt: { lt: evidence.observedAt },
    },
  });

  const classification = classifyEnforcement(evidence, { priorCorrectionCount });

  const liabilityEventId = await prisma.$transaction(async (tx) =>
    maybeAttachLiability(tx, {
      enforcementState: classification.enforcementState,
      enforcementOperatorId: opts.enforcementOperatorId,
      minterOperatorId,
      receiptId: finalized.receipt_id,
    })
  );

  return prisma.evidenceReceiptLink.create({
    data: {
      agentEvidenceId: evidence.id,
      eventCommitmentHash: evidence.eventCommitmentHash,
      receiptId: finalized.receipt_id,
      receiptCommitmentHash: row.contentHash,
      linkageType: classification.linkageType,
      enforcementState: classification.enforcementState,
      attributionMode: ATTRIBUTION_MODE,
      liabilityEventId,
      predicateVersion: classification.predicateVersion,
    },
  });
}
