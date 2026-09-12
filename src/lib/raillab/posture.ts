/**
 * Fail-Closed System Posture & Readiness (Phase 30).
 *
 * The audit found a CLASS of defects: assurance surfaces could silently degrade to a
 * falsely-healthy state (an open scheduler, an OK console during a partial outage, an OK
 * resilience report with no baseline). This module makes that class structurally impossible and
 * observable:
 *
 *   - It composes every assurance surface (attestation, safety interlock, console, lighthouse,
 *     resilience) in PARALLEL with per-source timeouts, so one slow/dead source can neither hang
 *     the report nor be mistaken for healthy.
 *   - It enforces the FAIL-CLOSED INVARIANT: any unreadable/unconfigured source forces severity
 *     >= WARNING; a failed interlock, an unverified attestation chain, a suspicious Lighthouse,
 *     or a degraded Resilience report forces SEVERE.
 *   - It self-verifies deployment readiness (required env, signing key, scheduler secret,
 *     database reachability, applied migrations) — no secret values are ever emitted.
 *
 * The composed report is signed via the shared report signer and fails closed in production.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/db";
import { REQUIRED_PROD_ENV } from "@/lib/config/env";
import { getExecutionSafetyFlag } from "./breach-response";
import {
  getLatestAttestation,
  verifyIntegrityAttestation,
  getIntegrityPublicKeyHex,
} from "./attest";
import { buildTrustConsole, type TrustSeverity } from "./console";
import { buildLighthouse } from "./lighthouse";
import { buildResilience } from "./resilience";
import { signReportPayload } from "./report-signing";

/** Per-source timeout: one slow dependency must never hang the whole posture. */
export const POSTURE_SOURCE_TIMEOUT_MS = 2000;

export const POSTURE_VERIFY_INSTRUCTIONS =
  "Recompute content_hash = sha256(canonicalJson(response without `snapshot`, top-level keys sorted)), then verify the ed25519 `signature` over utf8(content_hash) with `public_key`. If it verifies, the posture report was not tampered with.";

// ── Readiness (pure) ──

export interface ReadinessCheck {
  name: string;
  ok: boolean;
  /** Blocking checks make the deployment NOT ready; non-blocking are advisory (e.g. dev). */
  blocking: boolean;
  detail: string;
}

export interface ReadinessResult {
  ready: boolean;
  checks: ReadinessCheck[];
  blockers: string[];
}

export interface ReadinessInput {
  env: Record<string, string | undefined>;
  nodeEnv: string | undefined;
  dbReachable: boolean;
  migrationsApplied: boolean;
}

const HEX_KEY_RE = /^[0-9a-f]{64}$|^[0-9a-f]{128}$/i;

/**
 * Pure readiness evaluation. Reports only presence/validity — never a secret value.
 */
export function computeReadiness(input: ReadinessInput): ReadinessResult {
  const { env, nodeEnv, dbReachable, migrationsApplied } = input;
  const enforced = nodeEnv === "production" || nodeEnv === "staging";

  const missing = REQUIRED_PROD_ENV.filter((name) => !(env[name] ?? "").trim());
  const signingKeyOk = HEX_KEY_RE.test((env.SIGNING_PRIVATE_KEY ?? "").trim());
  const schedulerSecretOk = Boolean((env.SCHEDULER_SECRET ?? "").trim());

  const checks: ReadinessCheck[] = [
    {
      name: "required_env",
      ok: missing.length === 0,
      blocking: enforced,
      detail: missing.length === 0 ? "all required env present" : `missing: ${missing.join(", ")}`,
    },
    {
      name: "signing_key",
      ok: signingKeyOk,
      blocking: enforced,
      detail: signingKeyOk ? "valid ed25519 private key" : "missing or not 64/128-hex",
    },
    {
      name: "scheduler_secret",
      ok: schedulerSecretOk,
      // Only production requires the scheduler secret (dev/test permits an unset secret).
      blocking: nodeEnv === "production",
      detail: schedulerSecretOk ? "configured" : "unset (production scheduling disabled)",
    },
    {
      name: "database",
      ok: dbReachable,
      blocking: true,
      detail: dbReachable ? "reachable" : "unreachable",
    },
    {
      name: "migrations",
      ok: migrationsApplied,
      blocking: true,
      detail: migrationsApplied ? "applied" : "no applied migrations found",
    },
  ];

  const blockers = checks.filter((c) => !c.ok && c.blocking).map((c) => c.name);
  return { ready: blockers.length === 0, checks, blockers };
}

// ── Surface composition ──

export interface PostureSurfaces {
  attestation: { verified: boolean; chain_ok: boolean; unavailable?: boolean; detail?: string };
  safety: { halted: boolean; reason: string | null; unavailable?: boolean; detail?: string };
  console: { severity: TrustSeverity; degraded: boolean; unavailable?: boolean; detail?: string };
  lighthouse: { degraded: boolean; suspicious: boolean; unavailable?: boolean; detail?: string };
  resilience: {
    severity: TrustSeverity;
    survives: boolean;
    unavailable?: boolean;
    detail?: string;
  };
}

export interface PostureBlock {
  severity: TrustSeverity;
  ready: boolean;
  surfaces: PostureSurfaces;
  checks: ReadinessCheck[];
  blockers: string[];
  degraded: boolean;
  degraded_reasons: string[];
  generated_at: string;
}

export interface PostureResponse {
  success: true;
  posture: PostureBlock;
  verify_instructions: string;
  snapshot: { content_hash: string; signature: string; public_key: string; algorithm: "ed25519" };
}

const SEVERITY_RANK: Record<TrustSeverity, number> = { OK: 0, WARNING: 1, SEVERE: 2 };

interface Probe<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

/** Resolves a probe promise, converting rejection/timeout into a structured `ok:false`. */
async function probe<T>(name: string, p: Promise<T>, timeoutMs: number): Promise<Probe<T>> {
  const settled: Promise<Probe<T>> = p.then(
    (value) => ({ ok: true, value }),
    (err) => ({ ok: false, error: `${name}: ${err instanceof Error ? err.message : String(err)}` })
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Probe<T>>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, error: `${name}: timed out after ${timeoutMs}ms` }),
      timeoutMs
    );
  });
  try {
    return await Promise.race([settled, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Reads the latest attestation and offline-verifies it (hash + signature + chain link). */
async function probeAttestation(): Promise<PostureSurfaces["attestation"]> {
  const latest = await getLatestAttestation();
  if (!latest) {
    return { verified: false, chain_ok: false, detail: "no attestation yet" };
  }
  const { valid } = await verifyIntegrityAttestation({
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
    publicKey: latest.publicKey ?? getIntegrityPublicKeyHex(),
    algorithm: "ed25519",
  });
  let chainOk = true;
  if (latest.prevAttestationHash) {
    const prev = await prisma.integrityAttestation.findUnique({
      where: { attestationHash: latest.prevAttestationHash },
      select: { attestationHash: true },
    });
    chainOk = Boolean(prev);
  }
  return { verified: valid, chain_ok: chainOk };
}

/** Probes database reachability and whether any migration has been applied. */
async function probeDatabase(): Promise<{ reachable: boolean; migrationsApplied: boolean }> {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
  } catch {
    return { reachable: false, migrationsApplied: false };
  }
  let migrationsApplied = false;
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      "SELECT 1 FROM _prisma_migrations WHERE finished_at IS NOT NULL LIMIT 1"
    );
    migrationsApplied = Array.isArray(rows) && rows.length > 0;
  } catch {
    migrationsApplied = false;
  }
  return { reachable: true, migrationsApplied };
}

export interface BuildPostureOptions {
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  nodeEnv?: string | undefined;
}

// ── Cache policy ──

export function postureCacheControl(degraded: boolean, severity: TrustSeverity): string {
  return degraded || severity !== "OK" ? "private, no-store, max-age=0" : "private, max-age=60";
}

// ── Build (signed) ──

export async function buildPosture(
  now: Date = new Date(),
  opts: BuildPostureOptions = {}
): Promise<PostureResponse> {
  const timeoutMs = opts.timeoutMs ?? POSTURE_SOURCE_TIMEOUT_MS;
  const env = opts.env ?? process.env;
  const nodeEnv = opts.nodeEnv ?? process.env.NODE_ENV;

  // Every surface + the readiness probe run concurrently; none may reject the report.
  const [attR, safetyR, consoleR, lighthouseR, resilienceR, dbR] = await Promise.all([
    probe("attestation", probeAttestation(), timeoutMs),
    probe("safety", getExecutionSafetyFlag(), timeoutMs),
    probe("console", buildTrustConsole(), timeoutMs),
    probe("lighthouse", buildLighthouse(now), timeoutMs),
    probe("resilience", buildResilience(now), timeoutMs),
    probe("database", probeDatabase(), timeoutMs),
  ]);

  const degradedReasons: string[] = [];
  const unavailable = (error: string | undefined) => {
    if (error) degradedReasons.push(error);
  };

  const surfaces: PostureSurfaces = {
    attestation: attR.ok
      ? attR.value!
      : { verified: false, chain_ok: false, unavailable: true, detail: "unreadable" },
    safety: safetyR.ok
      ? { halted: safetyR.value!.halted, reason: safetyR.value!.reason ?? null }
      : { halted: false, reason: null, unavailable: true, detail: "unreadable" },
    console: consoleR.ok
      ? {
          severity: consoleR.value!.severity,
          degraded: consoleR.value!.degraded,
        }
      : { severity: "WARNING", degraded: true, unavailable: true, detail: "unreadable" },
    lighthouse: lighthouseR.ok
      ? {
          degraded: lighthouseR.value!.lighthouse.degraded,
          suspicious: lighthouseR.value!.lighthouse.persistence.integrity.suspicious,
        }
      : { degraded: true, suspicious: false, unavailable: true, detail: "unreadable" },
    resilience: resilienceR.ok
      ? {
          severity: resilienceR.value!.resilience.summary.severity,
          survives: resilienceR.value!.resilience.summary.survives,
        }
      : { severity: "WARNING", survives: false, unavailable: true, detail: "unreadable" },
  };

  if (!attR.ok) unavailable(attR.error);
  if (!safetyR.ok) unavailable(safetyR.error);
  if (!consoleR.ok) unavailable(consoleR.error);
  if (!lighthouseR.ok) unavailable(lighthouseR.error);
  if (!resilienceR.ok) unavailable(resilienceR.error);
  if (!dbR.ok) unavailable(dbR.error);

  const db = dbR.ok ? dbR.value! : { reachable: false, migrationsApplied: false };
  const readiness = computeReadiness({
    env,
    nodeEnv,
    dbReachable: db.reachable,
    migrationsApplied: db.migrationsApplied,
  });

  // FAIL-CLOSED INVARIANT: fold every source into the severity; nothing may silently read OK.
  let severity: TrustSeverity = "OK";
  const bump = (s: TrustSeverity) => {
    if (SEVERITY_RANK[s] > SEVERITY_RANK[severity]) severity = s;
  };

  // Unreadable/unconfigured source → at least WARNING.
  if (
    !attR.ok ||
    !safetyR.ok ||
    !consoleR.ok ||
    !lighthouseR.ok ||
    !resilienceR.ok ||
    !dbR.ok ||
    !readiness.ready
  ) {
    bump("WARNING");
  }

  // Failed hard checks → SEVERE.
  if (!surfaces.attestation.verified || !surfaces.attestation.chain_ok) bump("SEVERE");
  if (surfaces.safety.halted) bump("SEVERE");
  if (surfaces.console.severity === "SEVERE") bump("SEVERE");
  if (surfaces.lighthouse.suspicious) bump("SEVERE");
  if (surfaces.resilience.severity === "SEVERE") bump("SEVERE");
  if (readiness.blockers.length > 0) bump("SEVERE");

  // Advisory WARNINGs from otherwise-readable sources.
  if (surfaces.console.severity === "WARNING" || surfaces.console.degraded) bump("WARNING");
  if (surfaces.lighthouse.degraded) bump("WARNING");
  if (surfaces.resilience.severity === "WARNING") bump("WARNING");

  const posture: PostureBlock = {
    severity,
    ready: readiness.ready,
    surfaces,
    checks: readiness.checks,
    blockers: readiness.blockers,
    degraded: degradedReasons.length > 0,
    degraded_reasons: degradedReasons,
    generated_at: now.toISOString(),
  };

  const signedBody: Record<string, unknown> = {
    success: true,
    posture,
    verify_instructions: POSTURE_VERIFY_INSTRUCTIONS,
  };
  const snapshot = signReportPayload(signedBody);

  return {
    success: true,
    posture,
    verify_instructions: POSTURE_VERIFY_INSTRUCTIONS,
    snapshot: { ...snapshot, algorithm: "ed25519" },
  };
}