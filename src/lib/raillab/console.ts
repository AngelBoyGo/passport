/**
 * Operational Trust Console (Phase 25) — visible, legible, independently verifiable assurance.
 *
 * Aggregates the safety interlock, the latest signed attestation (with offline verification of
 * its hash+signature and chain-link), and rail health into a single, severity-tilted payload that
 * operators and autonomous agents can act on. Read-only over the ledgers — moves no money.
 */

import { prisma } from "@/lib/db";
import { getExecutionSafetyFlag } from "./breach-response";
import { getLatestAttestation, verifyIntegrityAttestation, getIntegrityPublicKeyHex } from "./attest";
import { SETTLEMENT_VELOCITY_WINDOW_MS, SETTLEMENT_VELOCITY_BURST_THRESHOLD } from "./integrity";

export type TrustSeverity = "OK" | "WARNING" | "SEVERE";

export interface TrustConsole {
  safety: {
    halted: boolean;
    haltedAt: string | null;
    reason: string | null;
    causedByAttestationId: string | null;
    version: number;
  };
  attestation: {
    verified: boolean;
    chainOk: boolean;
    prevLinked: boolean;
    issues: string[];
  };
  rails: {
    total: number;
    enabled: number;
    quarantined: number;
    byKind: Record<string, number>;
    velocityAlerts: string[];
    pendingReviewStale: number;
  };
  severity: TrustSeverity;
  degraded: boolean;
  degradedReasons: string[];
  generatedAt: string;
  cacheControl: "private, max-age=30" | "no-store";
}

/**
 * Offline-verifies the latest stored attestation (recompute hash + Ed25519 signature) and checks
 * the chain link resolves to a stored previous row.
 */
async function verifyLatestAttestation(): Promise<{
  verified: boolean;
  chainOk: boolean;
  prevLinked: boolean;
  issues: string[];
}> {
  const latest = await getLatestAttestation();
  if (!latest) {
    return { verified: false, chainOk: false, prevLinked: false, issues: ["no attestation yet"] };
  }
  const issues: string[] = [];

const { valid, reason } = await verifyIntegrityAttestation({
    attestationId: latest.attestationId,
    checkedAt: latest.checkedAt.toISOString(),
    ok: latest.ok,
    supplyConsistent: latest.supplyConsistent,
    fractionalConsistent: latest.fractionalConsistent,
    lpInvariantOk: latest.lpInvariantOk,
    pendingReviewStale: latest.pendingReviewStale,
    settledTotalCredited: latest.settledTotalCredited,
    settledTotalRows: latest.settledTotalRows,
    issues: (latest.issues as string[]) ?? [],
    prevAttestationHash: latest.prevAttestationHash,
    attestationHash: latest.attestationHash,
    signature: latest.signature,
    // Verify against the key that ACTUALLY signed this attestation (stored on the row).
    // Re-deriving from the CURRENT signing key would false-fail every historic attestation
    // after a key rotation, permanently flagging SEVERE on a healthy ledger.
    publicKey: latest.publicKey ?? getIntegrityPublicKeyHex(),
    algorithm: "ed25519",
  });
  const verified = valid;
  if (!verified) {
    issues.push(`attestation signature/hash NOT verified: ${reason ?? "unknown"}`);
  }

  let chainOk = true;
  let prevLinked = false;
  if (latest.prevAttestationHash) {
    const prev = await prisma.integrityAttestation.findUnique({
      where: { attestationHash: latest.prevAttestationHash },
      select: { attestationHash: true },
    });
    prevLinked = Boolean(prev);
    if (!prev) {
      chainOk = false;
      issues.push("attestation chain link missing (prev hash does not resolve to a stored row)");
    }
  }

  return { verified, chainOk, prevLinked, issues };
}

/**
 * Aggregates the trust console. Cache rules are computed so the route can emit the right header:
 * SEVERE states are never cached (agents must always see the current halt).
 */
export async function buildTrustConsole(): Promise<TrustConsole> {
  const safety = await getExecutionSafetyFlag();
  const { verified, chainOk, prevLinked, issues } = await verifyLatestAttestation();

  // Rail health rollup.
  const rails = await prisma.railSpec.findMany({
    select: { state: true, ledgerKind: true },
  });
  const byKind: Record<string, number> = {};
  let enabled = 0;
  let quarantined = 0;
  for (const r of rails) {
    byKind[r.ledgerKind] = (byKind[r.ledgerKind] ?? 0) + 1;
    if (r.state === "ENABLED") enabled++;
    if (r.state === "QUARANTINED") quarantined++;
  }

  // Velocity alerts (same window/threshold as the integrity check).
  const velocitySince = new Date(Date.now() - SETTLEMENT_VELOCITY_WINDOW_MS);
  const velocityAlerts: string[] = [];
  const degradedReasons: string[] = [];
  try {
    const recentSettled = await prisma.railSettlement.findMany({
      where: { status: "SETTLED", settledAt: { gte: velocitySince } },
      select: { railKey: true },
    });
    const counts: Record<string, number> = {};
    for (const s of recentSettled) counts[s.railKey] = (counts[s.railKey] ?? 0) + 1;
    for (const [railKey, count] of Object.entries(counts)) {
      if (count > SETTLEMENT_VELOCITY_BURST_THRESHOLD) {
        velocityAlerts.push(`${railKey}:${count}`);
      }
    }
  } catch {
    // A failed scan is NOT the same as "no anomaly" — surface it so a partial outage never
    // reads as OK. (Also recorded in velocityAlerts for backward-compatible consumers.)
    velocityAlerts.push("(velocity scan unavailable)");
    degradedReasons.push("settlement velocity scan unavailable");
  }

  // pending_review_stale.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let pendingReviewStale = 0;
  try {
    pendingReviewStale = await prisma.railSettlement.count({
      where: { status: { in: ["PENDING", "PENDING_REVIEW"] }, createdAt: { lt: cutoff } },
    });
  } catch {
    pendingReviewStale = 0;
    // Fail-open guard: an unreadable count must tilt severity, not silently claim zero.
    degradedReasons.push("pending-review scan unavailable");
  }

  const degraded = degradedReasons.length > 0;

  // Severity tilt.
  const chainUnverified = !verified || !chainOk;
  const severity: TrustSeverity =
    safety.halted || chainUnverified
      ? "SEVERE"
      : velocityAlerts.length > 0 || pendingReviewStale > 0 || degraded
        ? "WARNING"
        : "OK";

  return {
    safety: {
      halted: safety.halted,
      haltedAt: safety.haltedAt ? safety.haltedAt.toISOString() : null,
      reason: safety.reason,
      causedByAttestationId: safety.causedByAttestationId,
      version: safety.version,
    },
    attestation: { verified, chainOk, prevLinked, issues },
    rails: {
      total: rails.length,
      enabled,
      quarantined,
      byKind,
      velocityAlerts,
      pendingReviewStale,
    },
    severity,
    degraded,
    degradedReasons,
    generatedAt: new Date().toISOString(),
    // ISSUER-gated: never let a shared cache store the gated body (or a halt).
    cacheControl: severity === "SEVERE" ? "no-store" : "private, max-age=30",
  };
}