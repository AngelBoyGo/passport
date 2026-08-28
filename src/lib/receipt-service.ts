import { prisma } from "./db";
import { signReceipt } from "./receipt/signer";
import { validateFinalizeInput } from "./receipt/finalize";
import { computeContentHash, computeDomainCommitment } from "./receipt/canonical";
import { bytesToHex } from "@noble/hashes/utils.js";
import type {
  IssueReceiptInput,
  FinalizeReceiptInput,
  ReceiptPayload,
  ReceiptType,
} from "./receipt/types";
import { ErrorTranche } from "@prisma/client";
import type { OperationalDomain } from "@prisma/client";
import {
  recordCapabilityEvent,
  recordMatchEvent,
  decrementCredits,
  ensureAgent,
  operatorIdFromStripe,
} from "./operator";
import { shouldApplySlashing } from "./escrow/penalties";
import { applySlashingInTransaction } from "./escrow/slashing";

/**
 * Converts a DB receipt row to a ReceiptPayload for verification.
 */
export function dbReceiptToPayload(row: {
  receiptId: string;
  issuedAt: Date;
  operatorId: string;
  agentId: string;
  receiptType: string;
  status: string;
  inputDigest: string;
  authorityScope: string;
  expiry: Date;
  revocationStatus: string;
  outputHash: string | null;
  refusalReason: string | null;
  terminalReason: string | null;
  prevReceiptHash: string | null;
  contentHash: string;
  signature: string | null;
  domain: OperationalDomain | null;
  domainCommitment: string | null;
  blindSalt: string | null;
  errorTranche: ErrorTranche | null;
}): ReceiptPayload {
  const payload: ReceiptPayload = {
    receipt_id: row.receiptId,
    issued_at: row.issuedAt.toISOString(),
    operator_id: row.operatorId,
    agent_id: row.agentId,
    receipt_type: row.receiptType as ReceiptType,
    status: row.status as ReceiptPayload["status"],
    input_digest: row.inputDigest,
    authority_scope: row.authorityScope,
    expiry: row.expiry.toISOString(),
    revocation_status: row.revocationStatus as ReceiptPayload["revocation_status"],
    output_hash: row.outputHash ?? undefined,
    refusal_reason: row.refusalReason ?? undefined,
    terminal_reason: row.terminalReason ?? undefined,
    prev_receipt_hash: row.prevReceiptHash ?? undefined,
    domain: row.domain ?? undefined,
    domain_commitment: row.domainCommitment ?? undefined,
    blind_salt: row.blindSalt ?? undefined,
    error_tranche:
      row.status !== "pending" && row.errorTranche != null
        ? row.errorTranche
        : undefined,
    content_hash: row.contentHash,
    signature: row.signature ?? undefined,
  };
  return payload;
}

/**
 * Issues a pending signed receipt and decrements operator credits.
 */
export async function issueReceipt(
  operatorDbId: string,
  input: IssueReceiptInput
) {
  // B23: enforce max expiry of 1 year from now — prevents receipt expiry forgery.
  const MAX_EXPIRY_MS = 365 * 86400 * 1000;
  const expiryMs = new Date(input.expiry).getTime();
  if (!Number.isFinite(expiryMs) || expiryMs - Date.now() > MAX_EXPIRY_MS) {
    throw new Error("Expiry must be within 1 year from now");
  }

  // B32: server-authoritative issued_at — never trust client-supplied timestamps.
  const issuedAt = new Date();
  const receiptId = `rcpt_${crypto.randomUUID().replace(/-/g, "")}`;

  const draft: ReceiptPayload = {
    receipt_id: receiptId,
    issued_at: issuedAt.toISOString(),
    operator_id: input.operator_id,
    agent_id: input.agent_id,
    receipt_type: input.receipt_type,
    status: "pending",
    input_digest: input.input_digest,
    authority_scope: input.authority_scope,
    expiry: input.expiry,
    revocation_status: "active",
    prev_receipt_hash: input.prev_receipt_hash,
    content_hash: "",
  };

  let persistDomain: OperationalDomain | null = input.domain ?? null;
  let domainCommitment: string | null = null;
  let blindSalt: string | null = null;

  if (input.blind && input.domain) {
    const saltBytes = new Uint8Array(32);
    crypto.getRandomValues(saltBytes);
    blindSalt = bytesToHex(saltBytes);
    domainCommitment = computeDomainCommitment(input.domain, blindSalt);
    draft.domain_commitment = domainCommitment;
    persistDomain = null;
  } else if (input.domain !== undefined) {
    draft.domain = input.domain;
  }

  draft.content_hash = computeContentHash(draft);

  const signed = await signReceipt(draft);

  const { row } = await prisma.$transaction(async (tx) => {
    const hasCredits = await decrementCredits(operatorDbId, 1, tx);
    if (!hasCredits) {
      throw new Error("Insufficient receipt credits");
    }

    const agent = await ensureAgent(
      operatorDbId,
      input.agent_id,
      input.authority_scope,
      tx
    );

    const row = await tx.receipt.create({
      data: {
        receiptId: signed.receipt_id,
        issuedAt,
        operatorId: operatorDbId,
        agentId: input.agent_id,
        agentRecordId: agent.id,
        receiptType: signed.receipt_type,
        status: signed.status,
        inputDigest: signed.input_digest,
        authorityScope: signed.authority_scope,
        expiry: new Date(signed.expiry),
        revocationStatus: signed.revocation_status,
        prevReceiptHash: signed.prev_receipt_hash,
        contentHash: signed.content_hash,
        signature: signed.signature,
        domain: persistDomain,
        domainCommitment,
        blindSalt,
      },
    });

    await recordCapabilityEvent(
      operatorDbId,
      "receipt_issued",
      input.agent_id,
      row.receiptId,
      undefined,
      tx
    );
    await recordMatchEvent(operatorDbId, "receipt_issued", row.receiptId, 1, undefined, tx);

    return { row };
  });

  return { row, signed };
}

/**
 * Finalizes a pending receipt with output, refusal, or terminal state.
 */
export async function finalizeReceipt(
  operatorDbId: string,
  receiptId: string,
  input: FinalizeReceiptInput
) {
  const validation = validateFinalizeInput(input);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const operator = await prisma.operator.findUnique({
    where: { id: operatorDbId },
  });
  if (!operator) throw new Error("Operator not found");

  const existing = await prisma.receipt.findFirst({
    where: { receiptId, operatorId: operatorDbId },
  });

  if (!existing) throw new Error("Receipt not found");
  if (existing.status !== "pending") {
    throw new Error("Receipt already finalized");
  }

  const draft: ReceiptPayload = {
    receipt_id: existing.receiptId,
    issued_at: existing.issuedAt.toISOString(),
    operator_id: operatorIdFromStripe(operator.stripeCustomerId),
    agent_id: existing.agentId,
    receipt_type: existing.receiptType as ReceiptType,
    status: input.status,
    input_digest: existing.inputDigest,
    authority_scope: existing.authorityScope,
    expiry: existing.expiry.toISOString(),
    revocation_status: existing.revocationStatus as ReceiptPayload["revocation_status"],
    output_hash: input.output_hash,
    refusal_reason: input.refusal_reason,
    terminal_reason: input.terminal_reason,
    prev_receipt_hash: existing.prevReceiptHash ?? undefined,
    content_hash: "",
  };
  if (existing.domainCommitment != null) {
    draft.domain_commitment = existing.domainCommitment;
  } else if (existing.domain != null) {
    draft.domain = existing.domain;
  }
  const boundErrorTranche =
    input.error_tranche ??
    (input.status === "success" ? ErrorTranche.NONE : undefined);
  if (boundErrorTranche !== undefined) {
    draft.error_tranche = boundErrorTranche;
  }
  draft.content_hash = computeContentHash(draft);

  const signed = await signReceipt(draft);

  const { row } = await prisma.$transaction(async (tx) => {
    const current = await tx.receipt.findFirst({
      where: { receiptId, operatorId: operatorDbId },
    });
    if (!current) throw new Error("Receipt not found");
    if (current.status !== "pending") {
      throw new Error("Receipt already finalized");
    }

    const row = await tx.receipt.update({
      where: { id: current.id },
      data: {
        status: signed.status,
        outputHash: signed.output_hash,
        refusalReason: signed.refusal_reason,
        terminalReason: signed.terminal_reason,
        contentHash: signed.content_hash,
        signature: signed.signature,
        errorTranche: boundErrorTranche ?? input.error_tranche,
        finalizedAt: new Date(),
      },
    });

    await recordCapabilityEvent(
      operatorDbId,
      "receipt_finalized",
      existing.agentId,
      row.receiptId,
      signed.status,
      tx
    );

    const slashTranche = boundErrorTranche ?? input.error_tranche;
    if (shouldApplySlashing(signed.status, slashTranche)) {
      await applySlashingInTransaction(
        tx,
        operatorDbId,
        row.receiptId,
        slashTranche!
      );
    }

    return { row };
  });

  return { row, signed };
}

/**
 * Fetches receipt and domain-scoped history for an agent.
 */
export async function getReceiptWithHistory(receiptId: string) {
  const receipt = await prisma.receipt.findUnique({
    where: { receiptId },
    include: { operator: true, agent: true },
  });
  if (!receipt) return null;

  const history = await prisma.receipt.findMany({
    where: {
      operatorId: receipt.operatorId,
      agentId: receipt.agentId,
      authorityScope: receipt.authorityScope,
      status: { not: "pending" },
    },
    orderBy: { issuedAt: "asc" },
    take: 50,
  });

  return { receipt, history };
}
