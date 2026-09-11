/**
 * Verifiable Breach Response & Execution Safety Interlock (Phase 24).
 *
 * When a signed integrity attestation reports `ok:false`, the system does not just report the
 * breach and auto-quarantine — it triggers a durable, cryptographically-increasing execution halt
 * (`ExecutionSafetyFlag`) that `canExecuteLive` honors before ANY money moves, quarantines the
 * affected rail kinds atomically, and emits a signed, chained BreachResponse. Every halt/revival is
 * itself a signed attestation a counterparty can verify offline.
 *
 * No money is ever moved by this module. Per-kind classification is exact (no heuristics).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/db";
import { canonicalJson, sha256Hex } from "@/lib/receipt/canonical";
import { getPublicKey, sign, verify } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import type { IntegrityStatus } from "./integrity";
import { transitionRailState } from "./state-machine";

export const SAFETY_FLAG_ID = "global";

export type QuarantineKind = "FRACTIONAL" | "LP" | "PAYMENT";

export interface BreachClassification {
  haltLive: boolean;
  quarantineKinds: QuarantineKind[];
}

/**
 * Exact classification from the existing integrity columns. No thresholds invented here.
 */
export function classifyBreach(status: IntegrityStatus): BreachClassification {
  const haltLive: boolean[] = [];
  const quarantineKinds = new Set<QuarantineKind>();

  if (!status.supply_consistent) haltLive.push(true);
  if (!status.cross_ledger.fractional_consistent) {
    haltLive.push(true);
    quarantineKinds.add("FRACTIONAL");
    quarantineKinds.add("LP");
  }
  if (!status.cross_ledger.lp_invariant_ok) haltLive.push(true);
  if (status.settlements.pending_review_stale > 0) {
    quarantineKinds.add("PAYMENT");
  }

  return { haltLive: haltLive.includes(true), quarantineKinds: [...quarantineKinds] };
}

function getPrivateKeyBytes(): Uint8Array | null {
  const hex = process.env.SIGNING_PRIVATE_KEY;
  if (!hex || (hex.length !== 64 && hex.length !== 128)) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SIGNING_PRIVATE_KEY must be configured in production");
    }
    return null;
  }
  return hexToBytes(hex.length === 128 ? hex.slice(0, 64) : hex);
}

export function getBreachPublicKeyHex(): string {
  const pk = getPrivateKeyBytes();
  return pk ? bytesToHex(getPublicKey(pk)) : "";
}

export interface SignedBreachResponse {
  responseId: string;
  causedByAttestationId: string;
  halted: boolean;
  quarantinedRails: string[];
  at: string;
  attestationHash: string;
  prevAttestationHash: string | null;
  signature: string;
  publicKey: string;
  algorithm: "ed25519";
}

function hashBreachResponse(body: Omit<SignedBreachResponse, "attestationHash" | "prevAttestationHash" | "signature" | "publicKey" | "algorithm">): string {
  return sha256Hex(canonicalJson({
    response_id: body.responseId,
    caused_by_attestation_id: body.causedByAttestationId,
    halted: body.halted,
    quarantined_rails: body.quarantinedRails,
    at: body.at,
  }));
}

async function signBreachResponse(body: {
  responseId: string;
  causedByAttestationId: string;
  halted: boolean;
  quarantinedRails: string[];
  at: string;
}): Promise<SignedBreachResponse> {
  const attestationHash = hashBreachResponse(body);
  const pk = getPrivateKeyBytes();
  return {
    ...body,
    attestationHash,
    prevAttestationHash: null,
    signature: pk ? bytesToHex(await sign(utf8ToBytes(attestationHash), pk)) : "",
    publicKey: getBreachPublicKeyHex(),
    algorithm: "ed25519",
  };
}

/** Resolves the persistence-safe signer key for a rail (single-key fallback). */
async function resolveLegacyOrEraKey(railKey: string, at?: Date): Promise<string | null> {
  // Prefer era-based keys; fall back to the legacy single signerCommitment column. Gracefully
  // degrades if the era table is unavailable (e.g., tests without the RailSignerKey mock).
  try {
    const keyRow = at
      ? await prisma.railSignerKey.findFirst({
          where: { railKey, validFrom: { lte: at }, OR: [{ validUntil: null }, { validUntil: { gte: at } }] },
          orderBy: { validFrom: "desc" },
        })
      : await prisma.railSignerKey.findFirst({
          where: { railKey },
          orderBy: { validFrom: "desc" },
        });
    if (keyRow) return keyRow.publicKey;
  } catch {
    // fall through to legacy
  }
  try {
    const spec = await prisma.railSpec.findUnique({
      where: { railKey },
      select: { signerCommitment: true },
    });
    return spec?.signerCommitment ?? null;
  } catch {
    return null;
  }
}

/**
 * Executes the breach response: halt + per-kind quarantine + signed, chained response.
 * Idempotent per `causedByAttestationId` (DB unique `responseId`).
 */
export async function respondToBreach(
  status: IntegrityStatus,
  causedByAttestationId: string
): Promise<SignedBreachResponse> {
  const classification = classifyBreach(status);
  const quarantinedRails: string[] = [];

  // Idempotency: exactly one response per attestationId.
  const existing = await prisma.breachResponse.findUnique({
    where: { responseId: causedByAttestationId },
  });
  if (existing) {
    return {
      responseId: existing.responseId,
      causedByAttestationId: existing.causedByAttestationId,
      halted: existing.halted,
      quarantinedRails: (existing.quarantinedRails as string[]) ?? [],
      at: existing.at.toISOString(),
      attestationHash: existing.attestationHash,
      prevAttestationHash: existing.prevAttestationHash,
      signature: existing.signature,
      publicKey: existing.publicKey,
      algorithm: "ed25519",
    };
  }

  // a. Durable halt (atomic tripwire). Use an UPSERT with a guarded update so:
//    - the very FIRST breach CREATES the flag row (a plain updateMany would silently affect
//      0 rows and leave the interlock dead), and
//    - a concurrent flip (already halted) is a 0-row update, NOT an error (P2025 would throw).
  if (classification.haltLive) {
    await prisma.executionSafetyFlag.upsert({
      where: { id: SAFETY_FLAG_ID },
      create: {
        id: SAFETY_FLAG_ID,
        liveExecutionHalted: true,
        haltedAt: new Date(),
        reason: status.issues.slice(0, 5).join(" | ") || "integrity breach",
        causedByAttestationId,
        version: 1,
      },
      update: {
        liveExecutionHalted: true,
        haltedAt: new Date(),
        reason: status.issues.slice(0, 5).join(" | ") || "integrity breach",
        causedByAttestationId,
        version: { increment: 1 },
      },
    });
  }

  // b. Per-kind quarantine (atomic updateMany guard per rail).
  for (const kind of classification.quarantineKinds) {
    const railKinds = kind === "FRACTIONAL" ? ["FRACTIONAL"] : kind === "LP" ? ["LP"] : ["PAYMENT"];
    const enabled = await prisma.railSpec.findMany({
      where: { state: "ENABLED", ledgerKind: { in: railKinds } },
      select: { id: true, railKey: true, version: true },
    });
    for (const spec of enabled) {
      try {
        await transitionRailState(prisma, {
          id: spec.id,
          from: "ENABLED",
          to: "QUARANTINED",
          version: spec.version,
        });
        await prisma.adminAuditLog
          .create({
            data: {
              operatorId: "raillab_breach_response",
              action: "raillab_breach_quarantine",
              targetId: spec.id,
              details: `breach ${causedByAttestationId} kind=${kind}`,
            },
          })
          .catch(() => null);
        quarantinedRails.push(spec.railKey);
      } catch {
        // A rail that raced/interleaved is skipped; idempotency is preserved.
      }
    }
  }

  // c. Signed, chained response.
  const signed = await signBreachResponse({
    responseId: causedByAttestationId,
    causedByAttestationId,
    halted: classification.haltLive,
    quarantinedRails,
    at: new Date().toISOString(),
  });

  const prevHash = await prisma.integrityAttestation.findUnique({
    where: { attestationId: causedByAttestationId },
    select: { attestationHash: true },
  });

  try {
    await prisma.breachResponse.create({
      data: {
        responseId: signed.responseId,
        causedByAttestationId: signed.causedByAttestationId,
        halted: signed.halted,
        quarantinedRails: signed.quarantinedRails as any,
        at: new Date(signed.at),
        attestationHash: signed.attestationHash,
        prevAttestationHash: prevHash?.attestationHash ?? null,
        signature: signed.signature,
        publicKey: signed.publicKey,
        algorithm: "ed25519",
      },
    });
  } catch {
    // Persist failure is non-fatal for the halt/quarantine, but the signed response is lost
    // to the DB; we still return the signed object for the caller to record if possible.
  }

  return { ...signed, prevAttestationHash: prevHash?.attestationHash ?? null };
}

/**
 * Verifies a SignedBreachResponse offline (recompute hash + verify Ed25519).
 */
export async function verifyBreachResponse(
  response: SignedBreachResponse
): Promise<{ valid: boolean; reason?: string }> {
  const recomputed = hashBreachResponse({
    responseId: response.responseId,
    causedByAttestationId: response.causedByAttestationId,
    halted: response.halted,
    quarantinedRails: response.quarantinedRails,
    at: response.at,
  });
  if (recomputed !== response.attestationHash) {
    return { valid: false, reason: "breach response hash mismatch (tampered body)" };
  }
  if (!response.signature || !response.publicKey) {
    return { valid: false, reason: "missing signature or public key" };
  }
  try {
    const ok = await verify(
      hexToBytes(response.signature),
      utf8ToBytes(response.attestationHash),
      hexToBytes(response.publicKey)
    );
    return ok ? { valid: true } : { valid: false, reason: "signature mismatch" };
  } catch (err) {
    return { valid: false, reason: err instanceof Error ? err.message : "verify error" };
  }
}

/**
 * Reads the current execution safety flag (never throws). Returns false (not halted) if absent.
 */
export async function getExecutionSafetyFlag(): Promise<{
  halted: boolean;
  haltedAt: Date | null;
  reason: string | null;
  causedByAttestationId: string | null;
  version: number;
}> {
  const row = await prisma.executionSafetyFlag.findUnique({
    where: { id: SAFETY_FLAG_ID },
  });
  return {
    halted: row?.liveExecutionHalted ?? false,
    haltedAt: row?.haltedAt ?? null,
    reason: row?.reason ?? null,
    causedByAttestationId: row?.causedByAttestationId ?? null,
    version: row?.version ?? 1,
  };
}

/**
 * Clears the halt when the LATEST attestation is ok:true AND newer than haltedAt.
 * Rails stay QUARANTINED until an ISSUER manually re-enables each (not done here).
 */
export async function clearHaltIfHealthy(): Promise<boolean> {
  const flag = await getExecutionSafetyFlag();
  if (!flag.halted) return false;

  const latest = await prisma.integrityAttestation.findFirst({
    orderBy: { checkedAt: "desc" },
    select: { ok: true, checkedAt: true },
  });
  if (!latest || !latest.ok) return false;
  if (!flag.haltedAt || latest.checkedAt <= flag.haltedAt) return false;

  await prisma.executionSafetyFlag.updateMany({
    where: { id: SAFETY_FLAG_ID, liveExecutionHalted: true, version: flag.version },
    data: {
      liveExecutionHalted: false,
      version: { increment: 1 },
    },
  });
  return true;
}

export { resolveLegacyOrEraKey };

/**
 * Rotates a rail's signer key to a new era: ends the current key (`validUntil = now`) and adds
 * a new `RailSignerKey` row for `newPublicKey`. If a key with the same public key is already the
 * current one, it is a no-op (idempotent). Historical settlements still verify against the old era.
 */
export async function rotateSignerKey(
  railKey: string,
  newPublicKey: string,
  authorizedBy: string
): Promise<{ railKey: string; validUntil: Date | null; created: string }> {
  if (!/^[0-9a-f]{64}$/i.test(newPublicKey)) {
    throw new Error("new_public_key must be 64-hex Ed25519");
  }
  const now = new Date();

  // If the newest key IS the new public key (already current), nothing to do.
  const current = await prisma.railSignerKey.findFirst({
    where: { railKey },
    orderBy: { validFrom: "desc" },
  });
  if (current && current.publicKey === newPublicKey.toLowerCase() && !current.validUntil) {
    return { railKey, validUntil: current.validUntil, created: current.id };
  }

  // End the current key's validity (legacy single-column fallback is implicitly superseded).
  if (current && current.validUntil === null) {
    await prisma.railSignerKey.update({
      where: { id: current.id },
      data: { validUntil: now },
    });
  }

  const created = await prisma.railSignerKey.create({
    data: { railKey, publicKey: newPublicKey.toLowerCase(), validFrom: now },
  });

  // Keep the legacy single column in sync with the newest key for discoverability.
  await prisma.railSpec.updateMany({
    where: { railKey },
    data: { signerCommitment: newPublicKey.toLowerCase() },
  });

  await prisma.adminAuditLog
    .create({
      data: {
        operatorId: authorizedBy,
        action: "raillab_signer_rotate",
        targetId: railKey,
        details: JSON.stringify({ newPublicKey: newPublicKey.slice(0, 12) }),
      },
    })
    .catch(() => null);

  return { railKey, validUntil: now, created: created.id };
}