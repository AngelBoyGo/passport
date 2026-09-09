/**
 * Authenticated Settlement Webhook service (Phase 21).
 *
 * The real-money entrypoint for the Rail Factory: an external actor (agent, mobile-money
 * provider, corridor checkpoint) presents a signed, idempotent settlement request for an
 * ENABLED rail. The service:
 *   a. Loads the RailSpec (must be ENABLED) and enforces the idempotency key contract.
 *   b. Verifies the Ed25519 signature over canonicalJson(payload) against the rail's
 *      authorized signer commitment.
 *   c. Idempotency: RailSettlement has @@unique([railKey, reference]); a redelivered
 *      reference returns the ORIGINAL row (no double-settle).
 *   d. Dispatches to `executeRailSettlement` (ledgerKind routing; live only when the rail
 *      has a real endpoint — dry-run otherwise). NEVER fabricates money.
 *   e. Marks SETTLED/PENDING_REVIEW and records RailTelemetry + AdminAuditLog.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/db";
import { canonicalJson } from "@/lib/receipt/canonical";
import { verify } from "@noble/ed25519";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { executeRailSettlement } from "./executor";
import { recordSettlement, getRailTelemetry } from "./telemetry";

export type SettlementStatus =
  | "PENDING"
  | "SETTLED"
  | "PENDING_REVIEW"
  | "REJECTED";

export interface SettleInput {
  payload: Record<string, unknown>;
  reference: string;
  signature: string;
  publicKey?: string;
}

export interface SettleResult {
  deduped: boolean;
  settlementId: string;
  railKey: string;
  reference: string;
  status: string;
  live: boolean;
  creditedAngel: number;
  errorTranche: string;
}

const COMMITMENT_RE = /^[0-9a-f]{64}$/i;

/**
 * Verifies the Ed25519 signature over canonicalJson(payload) against the rail's signer
 * commitment (or an explicitly-provided public key, which must equal it).
 */
export async function verifySettlementSignature(
  payload: Record<string, unknown>,
  signatureHex: string,
  signerCommitment: string | null,
  providedPublicKey?: string
): Promise<{ valid: boolean; reason?: string; publicKey?: string }> {
  if (!signerCommitment) {
    return { valid: false, reason: "rail has no authorized signer commitment" };
  }
  if (!COMMITMENT_RE.test(signerCommitment)) {
    return { valid: false, reason: "signer commitment is not 64-hex" };
  }
  const publicKey = providedPublicKey ? providedPublicKey.toLowerCase() : signerCommitment;
  if (publicKey !== signerCommitment.toLowerCase()) {
    return { valid: false, reason: "provided public key does not match the rail's signer" };
  }
  if (!signatureHex || !/^[0-9a-f]{128}$/i.test(signatureHex)) {
    return { valid: false, reason: "signature must be 128-hex Ed25519" };
  }

  try {
    const canonical = canonicalJson(payload);
    const ok = await verify(
      hexToBytes(signatureHex),
      utf8ToBytes(canonical),
      hexToBytes(publicKey)
    );
    return ok ? { valid: true, publicKey } : { valid: false, reason: "signature mismatch" };
  } catch (err) {
    return { valid: false, reason: err instanceof Error ? err.message : "verification error" };
  }
}

/**
 * Settles one authenticated, idempotent rail settlement. Never throws on application-level
 * rejection; returns a structured result so the route can surface the right status.
 */
export async function settle(
  railKey: string,
  input: SettleInput
): Promise<SettleResult> {
// a. Load spec — must be ENABLED.
  const spec = await prisma.railSpec.findUnique({ where: { railKey } });
  if (!spec) {
    throw new Error(`RailSpec '${railKey}' not found`);
  }
  if (spec.state !== "ENABLED") {
    throw new Error(`Rail '${railKey}' is not ENABLED (current: ${spec.state})`);
  }

  const reference = input.reference;
  const signerCommitment = spec.signerCommitment ?? null;

  // b. Verify signature (capture reason; final status decided after the dedupe lock).
  const sigCheck = await verifySettlementSignature(
    input.payload,
    input.signature,
    signerCommitment,
    input.publicKey
  );

  const rawFx = input.payload.fx_rate_usd;
const parsedFx = typeof rawFx === "number" ? rawFx : Number(rawFx);
const fxRateUsd = Number.isFinite(parsedFx) && parsedFx > 0 ? parsedFx : null;

  // c. Idempotency lock: create PENDING with unique (railKey, reference); on collision
  //    return the ORIGINAL row (no double-settle).
  let settlementRow;
  try {
    settlementRow = await prisma.railSettlement.create({
      data: {
        settlementId: `RS-${railKey}-${reference}-${Date.now()}`,
        railKey,
        reference,
        signerCommitment: signerCommitment ?? sigCheck.publicKey ?? "",
        payload: input.payload as any,
        fxRateUsd,
        status: "PENDING",
      },
    });
  } catch {
    const existing = await prisma.railSettlement.findUnique({
      where: { railKey_reference: { railKey, reference } },
    });
    if (!existing) {
      throw new Error("Settlement idempotency read failed");
    }
    return {
      deduped: true,
      settlementId: existing.settlementId,
      railKey,
      reference,
      status: existing.status,
      live: false,
      creditedAngel: existing.creditedAngel,
      errorTranche: existing.errorTranche,
    };
  }

  const markReview = async (status: SettlementStatus, tranche: string, detail: string) => {
    await prisma.railSettlement
      .update({
        where: { id: settlementRow.id },
        data: { status, errorTranche: tranche },
      })
      .catch(() => null);
    await recordSettlement(railKey, {
      latencyMs: 0,
      volumeUnits: 0,
      dedupeHits: 0,
      errorTranche: tranche,
      settlementCount: 1,
    }).catch(() => null);
    await prisma.adminAuditLog
      .create({
        data: {
          operatorId: "raillab_settlement",
          action: status === "REJECTED" ? "raillab_settle_rejected" : "raillab_settle_review",
          targetId: `${railKey}:${reference}`,
          details: detail.slice(0, 1000),
        },
      })
      .catch(() => null);
  };

  // d1. Invalid signature -> REJECTED (audit-logged, no credit).
  if (!sigCheck.valid) {
    await markReview("REJECTED", "NONE", sigCheck.reason ?? "signature rejected");
    return {
      deduped: false,
      settlementId: settlementRow.settlementId,
      railKey,
      reference,
      status: "REJECTED",
      live: false,
      creditedAngel: 0,
      errorTranche: "NONE",
    };
  }

  // d2. Idempotency-key contract: reference must equal the payload key at the configured path.
  if (spec.idempotencyKeyPath && String(input.payload[spec.idempotencyKeyPath] ?? "") !== reference) {
    await markReview("PENDING_REVIEW", "LOGIC_DETECTION",
      `reference does not match the idempotency key at path '${spec.idempotencyKeyPath}'`);
    return {
      deduped: false,
      settlementId: settlementRow.settlementId,
      railKey,
      reference,
      status: "PENDING_REVIEW",
      live: false,
      creditedAngel: 0,
      errorTranche: "LOGIC_DETECTION",
    };
  }

  // e. Dispatch to the executor (ledgerKind routing; live only with a real endpoint).
  const startedAt = Date.now();
  let result;
  try {
    result = await executeRailSettlement(railKey, { payload: input.payload });
  } catch (err) {
    result = {
      live: false,
      ok: false,
      stage: (spec.ledgerKind as string),
      detail: err instanceof Error ? err.message : String(err),
      errorTranche: "SLA_BREACH",
    };
  }
  const latencyMs = Date.now() - startedAt;

  // f. Settled / PENDING_REVIEW + telemetry + audit.
  if (result.ok) {
    await prisma.railSettlement.update({
      where: { id: settlementRow.id },
      data: { status: "SETTLED", settledAt: new Date(), creditedAngel: result.creditedAngel ?? 0 },
    });
    await recordSettlement(railKey, {
      latencyMs,
      volumeUnits: result.creditedAngel ?? 0,
      dedupeHits: 0,
      errorTranche: "NONE",
      settlementCount: 1,
    }).catch(() => null);
    await prisma.adminAuditLog
      .create({
        data: {
          operatorId: "raillab_settlement",
          action: "raillab_settle_settled",
          targetId: `${railKey}:${reference}`,
          details: JSON.stringify({ live: result.live, stage: result.stage, detail: result.detail }),
        },
      })
      .catch(() => null);

    return {
      deduped: false,
      settlementId: settlementRow.settlementId,
      railKey,
      reference,
      status: "SETTLED",
      live: result.live,
      creditedAngel: result.creditedAngel ?? 0,
      errorTranche: "NONE",
    };
  }

  await markReview("PENDING_REVIEW", result.errorTranche, result.detail);
  return {
    deduped: false,
    settlementId: settlementRow.settlementId,
    railKey,
    reference,
    status: "PENDING_REVIEW",
    live: result.live,
    creditedAngel: 0,
    errorTranche: result.errorTranche,
  };
}

export { getRailTelemetry };

/** Settlements audit tail, optionally filtered by railKey/status. */
export async function listSettlements(opts?: {
  railKey?: string;
  status?: string;
  limit?: number;
}) {
  const where: Record<string, unknown> = {};
  if (opts?.railKey) where.railKey = opts.railKey;
  if (opts?.status) where.status = opts.status;

  return prisma.railSettlement.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(opts?.limit ?? 50, 1), 200),
  });
}

/** Updates a rail's authorized signer commitment (auth'd, audit-logged). */
export async function setRailSigner(
  specId: string,
  signerCommitment: string,
  authorizedBy: string
): Promise<void> {
  if (!COMMITMENT_RE.test(signerCommitment)) {
    throw new Error("signer_commitment must be 64-hex");
  }
  const spec = await prisma.railSpec.findUnique({ where: { id: specId } });
  if (!spec) {
    throw new Error("RailSpec not found");
  }
  await prisma.railSpec.update({
    where: { id: specId },
    data: { signerCommitment },
  });
  await prisma.adminAuditLog
    .create({
      data: {
        operatorId: authorizedBy,
        action: "raillab_set_signer",
        targetId: specId,
        details: JSON.stringify({ railKey: spec.railKey }),
      },
    })
    .catch(() => null);
}