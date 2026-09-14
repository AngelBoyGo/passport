/**
 * Object-level authorization & signed agent intents (Phase 31).
 *
 * The audit found an IDOR class: routes authenticated the CALLER but never authorized the
 * RESOURCE, and the "signatures" on value routes were decorative. This module makes
 * "may THIS caller act on THIS resource?" a reusable primitive, and makes agent-initiated value
 * operations carry a real Ed25519 signature over the exact operation (bound to amount/pool/batch,
 * nonce, and expiry; replayed nonces are rejected by a DB-unique guard).
 */

import { NextRequest } from "next/server";
import { verifyPinnedSignature } from "@/lib/auth/verifyPinnedSignature";
import "@/lib/receipt/crypto";
import { canonicalJson } from "@/lib/receipt/canonical";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";

/** Maximum accepted lifetime of an agent intent (now → expires_at). */
export const AGENT_INTENT_MAX_TTL_MS = 5 * 60_000;
const COMMITMENT_RE = /^[0-9a-f]{64}$/i;
const SIGNATURE_RE = /^[0-9a-f]{128}$/i;

export type ResourceKind = "agent" | "escrow" | "rail";

export type AuthorizeResult =
  | { ok: true; operatorId: string; role: "ISSUER" | "HOLDER" }
  | { ok: false; status: number; error: string };

async function operatorOwnsCommitment(operatorId: string, commitment: string): Promise<boolean> {
  if (!commitment) return false;
  const owned = await prisma.agent.findFirst({
    where: { operatorId, agentId: commitment },
    select: { id: true },
  });
  return Boolean(owned);
}

/**
 * Resolves the authenticated operator and asserts it may act on the named resource.
 * An ISSUER (non-HOLDER) key bypasses ownership (delegated operations).
 */
export async function authorizeResource(
  request: NextRequest,
  opts: { kind: ResourceKind; id: string }
): Promise<AuthorizeResult> {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (operator.apiKeyRole !== "HOLDER") {
    return { ok: true, operatorId: operator.id, role: "ISSUER" };
  }

  if (!opts.id) {
    return { ok: false, status: 400, error: "resource id is required" };
  }

  if (opts.kind === "agent") {
    const owns = await operatorOwnsCommitment(operator.id, opts.id);
    return owns
      ? { ok: true, operatorId: operator.id, role: "HOLDER" }
      : { ok: false, status: 403, error: "The authenticated operator does not own this agent" };
  }

  if (opts.kind === "escrow") {
    const escrow = await prisma.commodityEscrow.findUnique({ where: { escrowId: opts.id } });
    if (!escrow) return { ok: false, status: 404, error: "Escrow not found" };
    const party =
      (await operatorOwnsCommitment(operator.id, escrow.buyerCommitment)) ||
      (await operatorOwnsCommitment(operator.id, escrow.sellerCommitment));
    return party
      ? { ok: true, operatorId: operator.id, role: "HOLDER" }
      : { ok: false, status: 403, error: "The authenticated operator is not a party to this escrow" };
  }

  // kind === "rail"
  const spec = await prisma.railSpec.findUnique({ where: { railKey: opts.id } });
  if (!spec) return { ok: false, status: 404, error: "Rail not found" };
  if (spec.authorizedBy && spec.authorizedBy === operator.id) {
    return { ok: true, operatorId: operator.id, role: "HOLDER" };
  }
  return { ok: false, status: 403, error: "The authenticated operator does not own this rail" };
}

// ── Signed agent intents ──

export type IssuerResult =
  | { ok: true; operatorId: string }
  | { ok: false; status: number; error: string };

/**
 * Requires a trusted ISSUER (non-HOLDER) key. Used for platform/treasury/reserve operations
 * that are not agent-scoped (bridging, project registration, reserve governance proposals).
 */
export async function requireIssuer(request: NextRequest): Promise<IssuerResult> {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) return { ok: false, status: 401, error: "Unauthorized" };
  if (operator.apiKeyRole === "HOLDER") {
    return { ok: false, status: 403, error: "ISSUER key required" };
  }
  return { ok: true, operatorId: operator.id };
}
export interface AgentIntent {
  action: string;
  agent_commitment: string;
  resource_kind: ResourceKind;
  resource_id: string;
  params: Record<string, unknown>;
  nonce: string;
  expires_at: string;
  signature: string;
}

export type VerifyIntentResult =
  | { ok: true; agentCommitment: string }
  | { ok: false; status: number; error: string };

/** Canonical (signable) form of an intent — excludes the signature. */
export function canonicalIntentPayload(intent: Omit<AgentIntent, "signature">): string {
  return canonicalJson({
    action: intent.action,
    agent_commitment: intent.agent_commitment,
    resource_kind: intent.resource_kind,
    resource_id: intent.resource_id,
    params: intent.params,
    nonce: intent.nonce,
    expires_at: intent.expires_at,
  });
}

function valueEqual(a: unknown, b: unknown): boolean {
  return canonicalJson({ v: a }) === canonicalJson({ v: b });
}

export interface VerifyIntentInput {
  intent: unknown;
  expectAction: string;
  expectResource: { kind: ResourceKind; id: string };
  /** Subset of params that MUST match the intent exactly (binds the signature to the operation). */
  expectParams: Record<string, unknown>;
  now?: Date;
}

/**
 * Verifies an agent-signed intent: shape, action/resource/param binding, expiry, Ed25519
 * signature over the canonical payload (against the agent's registered enrollment key), and a
 * one-time nonce. Rejects tampered params, expired intents, wrong actors, and replays.
 */
export async function verifyAgentIntent(input: VerifyIntentInput): Promise<VerifyIntentResult> {
  const now = input.now ?? new Date();
  const raw = input.intent as Partial<AgentIntent> | null | undefined;
  if (!raw || typeof raw !== "object") {
    return { ok: false, status: 400, error: "signed intent is required" };
  }

  const intent = raw as AgentIntent;
  if (!COMMITMENT_RE.test(intent.agent_commitment ?? "")) {
    return { ok: false, status: 400, error: "intent.agent_commitment must be 64-hex" };
  }
  if (!SIGNATURE_RE.test(intent.signature ?? "")) {
    return { ok: false, status: 400, error: "intent.signature must be 128-hex" };
  }
  if (!intent.nonce || typeof intent.nonce !== "string") {
    return { ok: false, status: 400, error: "intent.nonce is required" };
  }
  if (!intent.params || typeof intent.params !== "object") {
    return { ok: false, status: 400, error: "intent.params must be an object" };
  }
  if (intent.action !== input.expectAction) {
    return { ok: false, status: 403, error: `intent action must be '${input.expectAction}'` };
  }
  if (
    intent.resource_kind !== input.expectResource.kind ||
    intent.resource_id !== input.expectResource.id
  ) {
    return { ok: false, status: 403, error: "intent resource does not match the operation" };
  }
  // For agent-kind operations the signer MUST be the acting agent itself.
  if (
    input.expectResource.kind === "agent" &&
    intent.agent_commitment.toLowerCase() !== input.expectResource.id.toLowerCase()
  ) {
    return { ok: false, status: 403, error: "intent signer is not the acting agent" };
  }

  // Param binding: every expected key must match exactly.
  for (const [key, expected] of Object.entries(input.expectParams)) {
    if (!valueEqual(intent.params[key], expected)) {
      return { ok: false, status: 403, error: `intent param '${key}' does not match the operation` };
    }
  }

  const expiresAt = Date.parse(intent.expires_at);
  if (!Number.isFinite(expiresAt)) {
    return { ok: false, status: 400, error: "intent.expires_at must be an ISO timestamp" };
  }
  if (expiresAt <= now.getTime()) {
    return { ok: false, status: 403, error: "intent has expired" };
  }
  if (expiresAt > now.getTime() + AGENT_INTENT_MAX_TTL_MS) {
    return { ok: false, status: 403, error: "intent expiry exceeds the maximum TTL" };
  }

  // Resolve the agent's registered key.
  const enrollment = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: intent.agent_commitment.toLowerCase() },
    select: { publicKey: true, status: true },
  });
  if (!enrollment || enrollment.status !== "ISSUED") {
    return { ok: false, status: 403, error: "agent is not enrolled" };
  }

  let valid = false;
  try {
    const { signature, ...payload } = intent;
    const canonical = canonicalIntentPayload(payload);
    const check = await verifyPinnedSignature({
      pinnedKey: enrollment.publicKey,
      signatureHex: signature,
      signPayload: canonical,
      context: "auth.verify-agent-intent",
      commitment: intent.agent_commitment,
    });
    valid = check.valid;
  } catch {
    valid = false;
  }
  if (!valid) {
    return { ok: false, status: 403, error: "intent signature is invalid" };
  }

  // One-time nonce (DB-unique) — reject replays. Consume only after the signature verifies.
  try {
    await prisma.agentIntentNonce.create({
      data: {
        nonce: intent.nonce,
        agentCommitment: intent.agent_commitment.toLowerCase(),
        action: intent.action,
        expiresAt: new Date(expiresAt),
      },
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002" || /unique|constraint/i.test(err instanceof Error ? err.message : "")) {
      return { ok: false, status: 403, error: "intent nonce has already been used (replay rejected)" };
    }
    throw err;
  }

  return { ok: true, agentCommitment: intent.agent_commitment.toLowerCase() };
}
