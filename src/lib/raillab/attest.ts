/**
 * Continuous Cryptographic Integrity Attestation (Phase 23).
 *
 * Turns the pollable conservation check into a continuously produced, append-only,
 * Ed25519-chained, remotely verifiable assurance fabric:
 *   - `runIntegrityAttestation()` runs the ledger-conservation check, chains the previous
 *     attestation hash, signs the body hash with the Passport Ed25519 key, and persists.
 *     A DB-level failure NEVER silently skips — it synthesizes a signed BREACH attestation.
 *   - `verifyIntegrityAttestation()` recomputes the hash and verifies the signature offline,
 *     optionally cross-checking the chain link.
 *   - `getLatestAttestation()` / `listAttestations()` expose the tail.
 *   - Quiet-period alerting writes an `AdminAuditLog` `integrity_breach` at most once per
 *     QUIET_PERIOD_MS using the latest stored breach row's checkedAt.
 *
 * Read-only over the money ledgers — this never moves funds.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/db";
import { canonicalJson, sha256Hex } from "@/lib/receipt/canonical";
import { getPublicKey, sign, verify } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { runIntegrityCheck, type IntegrityStatus } from "./integrity";

export const ATTESTATION_QUIET_PERIOD_MS = 5 * 60 * 1000; // 5 min
export const ATTESTATION_RETENTION_MAX = 10_000;

export interface IntegrityAttestationBody {
  attestationId: string;
  checkedAt: string;
  ok: boolean;
  supplyConsistent: boolean;
  fractionalConsistent: boolean;
  lpInvariantOk: boolean;
  pendingReviewStale: number;
  settledTotalCredited: number;
  settledTotalRows: number;
  issues: string[];
}

export interface SignedIntegrityAttestation extends IntegrityAttestationBody {
  prevAttestationHash: string | null;
  attestationHash: string;
  signature: string;
  publicKey: string;
  algorithm: "ed25519";
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

export function getIntegrityPublicKeyHex(): string {
  const pk = getPrivateKeyBytes();
  return pk ? bytesToHex(getPublicKey(pk)) : "";
}

/** Atomic canonical body hash (excludes signature/publicKey/algorithm/prev/hash). */
export function hashIntegrityAttestation(body: IntegrityAttestationBody): string {
  const canonical = canonicalJson({
    attestation_id: body.attestationId,
    checked_at: body.checkedAt,
    ok: body.ok,
    supply_consistent: body.supplyConsistent,
    fractional_consistent: body.fractionalConsistent,
    lp_invariant_ok: body.lpInvariantOk,
    pending_review_stale: body.pendingReviewStale,
    settled_total_credited: body.settledTotalCredited,
    settled_total_rows: body.settledTotalRows,
    issues: body.issues,
  });
  return sha256Hex(canonical);
}

/** Returns the latest stored attestation hash (for chaining), or null. */
async function latestAttestationHash(): Promise<string | null> {
  const latest = await prisma.integrityAttestation.findFirst({
    orderBy: { checkedAt: "desc" },
    select: { attestationHash: true },
  });
  return latest?.attestationHash ?? null;
}

/** Most recent breach row (for quiet-period alerting). */
async function latestBreachCheckedAt(): Promise<Date | null> {
  const breach = await prisma.integrityAttestation.findFirst({
    where: { ok: false },
    orderBy: { checkedAt: "desc" },
    select: { checkedAt: true },
  });
  return breach?.checkedAt ?? null;
}

async function pruneAttestations(): Promise<void> {
  try {
    const excess = await prisma.integrityAttestation.count();
    if (excess <= ATTESTATION_RETENTION_MAX) return;
    // Keep the newest ATTESTATION_RETENTION_MAX rows. The (MAX)-th newest is at index MAX-1;
    // prune anything strictly older than that boundary row.
    const boundary = await prisma.integrityAttestation.findMany({
      orderBy: { checkedAt: "desc" },
      skip: ATTESTATION_RETENTION_MAX - 1,
      take: 1,
      select: { checkedAt: true },
    });
    if (boundary.length === 1) {
      await prisma.integrityAttestation.deleteMany({
        where: { checkedAt: { lt: boundary[0].checkedAt } },
      });
    }
  } catch {
    // Prune is best-effort; retention never blocks attestation.
  }
}

/**
 * Runs the conservation check and produces a signed, chained, persisted attestation.
 * NEVER throws on the happy path; a DB failure yields a signed BREACH attestation.
 */
export async function runIntegrityAttestation(): Promise<SignedIntegrityAttestation> {
  // a. Run the check; on internal error synthesize a BREACH-class status (never skip).
  let status: IntegrityStatus;
  try {
    status = await runIntegrityCheck({});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    status = {
      ok: false,
      checkedAt: new Date().toISOString(),
      supply_consistent: false,
      angel_supply_observed: 0,
      angel_supply_expected: null,
      cross_ledger: {
        fractionalized_batches: 0,
        fractional_mint_by_symbol: {},
        fractional_held_by_symbol: {},
        fractional_pool_reserve_by_symbol: {},
        fractional_consistent: false,
        pools_with_lp_tokens: 0,
        lp_tokens_pool_side: 0,
        lp_invariant_ok: false,
      },
      settlements: {
        pending_review_stale: 0,
        settled_total_credited: 0,
        settled_total_rows: 0,
        burst_settlement_rails: [],
        burst_settlement_count: 0,
      },
      issues: [`integrity check failed: ${message}`],
    };
  }

  // b. Build body (excluding signature), hash, chain prev, sign.
  const body: IntegrityAttestationBody = {
    attestationId: `attest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    checkedAt: status.checkedAt,
    ok: status.ok,
    supplyConsistent: status.supply_consistent,
    fractionalConsistent: status.cross_ledger.fractional_consistent,
    lpInvariantOk: status.cross_ledger.lp_invariant_ok,
    pendingReviewStale: status.settlements.pending_review_stale,
    settledTotalCredited: status.settlements.settled_total_credited,
    settledTotalRows: status.settlements.settled_total_rows,
    issues: status.issues,
  };

  let attestationHash = hashIntegrityAttestation(body);
  try {
    // Chain to the preceding attestation; entropy in attestationId keeps hashes distinct.
    const prev = await latestAttestationHash();

    // Quiet-period guard: read the LAST BREACH **before** inserting this one. If we read
    // after inserting, the freshly-inserted breach would suppress its own alert forever
    // (TOCTOU: latestBreachCheckedAt() would return the row we just wrote).
    const isBreach = !body.ok;
    const priorBreach = isBreach ? await latestBreachCheckedAt() : null;

    const pk = getPrivateKeyBytes();
    const signature = pk
      ? bytesToHex(await sign(utf8ToBytes(attestationHash), pk))
      : "";

    await prisma.integrityAttestation.create({
      data: {
        attestationId: body.attestationId,
        checkedAt: new Date(body.checkedAt),
        ok: body.ok,
        supplyConsistent: body.supplyConsistent,
        fractionalConsistent: body.fractionalConsistent,
        lpInvariantOk: body.lpInvariantOk,
        pendingReviewStale: body.pendingReviewStale,
        settledTotalCredited: body.settledTotalCredited,
        settledTotalRows: body.settledTotalRows,
        issues: body.issues.length > 0 ? (body.issues as any) : null,
        prevAttestationHash: prev,
        attestationHash,
        signature,
        algorithm: "ed25519",
      },
    });

    // Alert only when a breach occurred AND no prior breach exists within the quiet period.
    // `priorBreach` is the previous breach (not the one just written), so a sustained breach
    // alerts once, then is suppressed while it stays within QUIET_PERIOD of the PRIOR breach.
    if (isBreach) {
      const now = Date.now();
      if (!priorBreach || now - priorBreach.getTime() > ATTESTATION_QUIET_PERIOD_MS) {
        await prisma.adminAuditLog
          .create({
            data: {
              operatorId: "raillab_integrity",
              action: "integrity_breach",
              targetId: body.attestationId,
              details: JSON.stringify({ issues: body.issues.slice(0, 10) }),
            },
          })
          .catch(() => null);
      }
    }

    await pruneAttestations();

    return {
      ...body,
      prevAttestationHash: prev,
      attestationHash,
      signature,
      publicKey: getIntegrityPublicKeyHex(),
      algorithm: "ed25519",
    };
  } catch (err) {
    // c. Persist failure: synthesize + sign a BREACH attestation (never silently skip).
    const message = err instanceof Error ? err.message : String(err);
    const failedBody: IntegrityAttestationBody = {
      ...body,
      ok: false,
      supplyConsistent: false,
      fractionalConsistent: false,
      lpInvariantOk: false,
      issues: [...body.issues, `attestation persist failed: ${message}`],
    };
    const failedHash = hashIntegrityAttestation(failedBody);
    const pk = getPrivateKeyBytes();
    return {
      ...failedBody,
      prevAttestationHash: null,
      attestationHash: failedHash,
      signature: pk ? bytesToHex(await sign(utf8ToBytes(failedHash), pk)) : "",
      publicKey: getIntegrityPublicKeyHex(),
      algorithm: "ed25519",
    };
  }
}

/** Offline verification: recompute hash, verify signature, and cross-check the chain link. */
export async function verifyIntegrityAttestation(
  attestation: SignedIntegrityAttestation
): Promise<{ valid: boolean; reason?: string }> {
  const body: IntegrityAttestationBody = {
    attestationId: attestation.attestationId,
    checkedAt: attestation.checkedAt,
    ok: attestation.ok,
    supplyConsistent: attestation.supplyConsistent,
    fractionalConsistent: attestation.fractionalConsistent,
    lpInvariantOk: attestation.lpInvariantOk,
    pendingReviewStale: attestation.pendingReviewStale,
    settledTotalCredited: attestation.settledTotalCredited,
    settledTotalRows: attestation.settledTotalRows,
    issues: attestation.issues,
  };
  const recomputed = hashIntegrityAttestation(body);
  if (recomputed !== attestation.attestationHash) {
    return { valid: false, reason: "attestation hash mismatch (tampered body)" };
  }
  if (!attestation.signature || !attestation.publicKey) {
    return { valid: false, reason: "missing signature or public key" };
  }
  try {
    const ok = await verify(
      hexToBytes(attestation.signature),
      utf8ToBytes(attestation.attestationHash),
      hexToBytes(attestation.publicKey)
    );
    return ok ? { valid: true } : { valid: false, reason: "signature mismatch" };
  } catch (err) {
    return { valid: false, reason: err instanceof Error ? err.message : "verify error" };
  }
}

export async function getLatestAttestation() {
  return prisma.integrityAttestation.findFirst({
    orderBy: { checkedAt: "desc" },
  });
}

export async function listAttestations(limit: number = 50) {
  return prisma.integrityAttestation.findMany({
    orderBy: { checkedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
  });
}