/**
 * ASMC-3 Phase 26 — Adoption Proof Loop (live end-to-end trust runbook).
 *
 * Proves the entire passport palette against a LIVE deployment over plain HTTP, in a
 * machine-readable, repeatable, third-party-runnable way — the "run it yourself" proof that
 * converts provable → adopted.
 *
 *   a. enroll an autonomous agent (PoW + Ed25519 possession) → capture subject commitment;
 *   b. post signed evidence (agent key) → verify canonical event-hash binding;
 *   c. issue + finalize a receipt → offline-verify the Ed25519 on `public-manifest`;
 *   d. provision a caller-owned adoption canary rail → settle it via /settle (signature-gated)
 *      → expect SETTLED (dry-run safe: canary has no live endpoint, so no money moves);
 *   e. fetch /raillab/console → assert severity ∈ {OK, WARNING};
 *   f. offline-verify the LATEST integrity attestation hash + signature (stored publicKey);
 *   g. tamper-check: flip one byte → /verify returns false.
 *
 * Idempotency: every reference is run-tagged (`adopt-<runid>-...`) and the canary rail is
 * provisioned via an idempotent ISSUER endpoint, so re-runs never mint duplicates.
 *
 * Usage (see scripts/README-smoke.md):
 *   BASE_URL=https://passport.example.com API_KEY=pp_issuer_... [SCHEDULER_SECRET=...] \
 *   ADOPTION_LOOP_RUN=1 npx tsx scripts/adoption-loop.ts [--cron]
 *
 * Exit 0 iff ok && attestation_verified && tamper_rejected. Machine-readable JSON report on
 * stdout; errors to stderr.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { keygen, sign, verify } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export const ADOPTION_LOOP_VERSION = "1.0.0";

// ── Pure crypto helpers (self-contained; mirrors src/lib/receipt/canonical.ts) ──

/** Deterministic JSON with top-level keys sorted — must match src/lib/receipt/canonical.ts. */
export function canonicalJson(obj: Record<string, unknown>): string {
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    ordered[key] = obj[key];
  }
  return JSON.stringify(ordered);
}

export function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}

export function newKeypair(): { secretKeyHex: string; publicKeyHex: string; secretKey: Uint8Array } {
  const { secretKey, publicKey } = keygen();
  return {
    secretKeyHex: bytesToHex(secretKey),
    publicKeyHex: bytesToHex(publicKey),
    secretKey,
  };
}

/** Mirrors hashIntegrityAttestation's canonical body exactly (snake_case keys, sorted). */
export function hashIntegrityAttestation(body: {
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
}): string {
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

/** Offline verification of a signed integrity attestation (hash + Ed25519 signature). */
export async function verifyAttestationOffline(a: {
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
  prevAttestationHash: string | null;
  attestationHash: string;
  signature: string;
  publicKey: string | null;
  algorithm?: string;
}): Promise<{ valid: boolean; reason?: string }> {
  const recomputed = hashIntegrityAttestation({
    attestationId: a.attestationId,
    checkedAt: a.checkedAt,
    ok: a.ok,
    supplyConsistent: a.supplyConsistent,
    fractionalConsistent: a.fractionalConsistent,
    lpInvariantOk: a.lpInvariantOk,
    pendingReviewStale: a.pendingReviewStale,
    settledTotalCredited: a.settledTotalCredited,
    settledTotalRows: a.settledTotalRows,
    issues: a.issues ?? [],
  });
  if (recomputed !== a.attestationHash) {
    return { valid: false, reason: "attestation hash mismatch (tampered body)" };
  }
  if (!a.signature || !a.publicKey) {
    return { valid: false, reason: "missing signature or public key" };
  }
  if (!/^[0-9a-f]{128}$/i.test(a.signature) || !/^[0-9a-f]{64}$/i.test(a.publicKey)) {
    return { valid: false, reason: "malformed signature/public key hex" };
  }
  try {
    const ok = await verify(
      hexToBytes(a.signature),
      utf8ToBytes(a.attestationHash),
      hexToBytes(a.publicKey)
    );
    return ok ? { valid: true } : { valid: false, reason: "signature mismatch" };
  } catch (err) {
    return { valid: false, reason: err instanceof Error ? err.message : "verify error" };
  }
}

/** Mirrors attest.ts solveAutonomousPoW (sha256 of `${nonce}:${candidate}`). */
export function solvePoW(challengeNonce: string, difficulty: number): string {
  const target = "0".repeat(Math.max(0, difficulty));
  let iteration = 0;
  while (true) {
    const candidate = String(iteration);
    const digest = sha256Hex(`${challengeNonce}:${candidate}`);
    if (digest.startsWith(target)) return candidate;
    iteration++;
  }
}

/** Mirrors attest.ts provision message: sha256(`${nonce}:${pow}:${pubKey}`) bytes. */
export function signProvisionProof(
  secretKey: Uint8Array,
  challengeNonce: string,
  powNonce: string,
  publicKeyHex: string
): string {
  const message = `${challengeNonce}:${powNonce}:${publicKeyHex.toLowerCase()}`;
  const digest = sha256(utf8ToBytes(message));
  return bytesToHex(sign(digest, secretKey));
}

/** Evidence signature: Ed25519 over utf8(sourceDigest(payload)) = sha256Hex(canonicalJson(payload)). */
export function signEvidencePayload(
  secretKey: Uint8Array,
  payload: Record<string, unknown>
): { signature: string; digest: string } {
  const digest = sha256Hex(canonicalJson(payload));
  return { signature: bytesToHex(sign(utf8ToBytes(digest), secretKey)), digest };
}

/** Settlement signature: Ed25519 over utf8(canonicalJson(payload)) (see settlement.ts). */
export function signSettlementPayload(
  secretKey: Uint8Array,
  payload: Record<string, unknown>
): string {
  return bytesToHex(sign(utf8ToBytes(canonicalJson(payload)), secretKey));
}

/** Flips the first nibble of a 64-hex string (tamper helper). */
export function flipAttestationHash(hash: string): string {
  if (hash.length !== 64) throw new Error("expected 64-hex attestation hash");
  const first = hash[0] === "0" ? "1" : "0";
  return first + hash.slice(1);
}

// ── HTTP client ──

export interface LoopConfig {
  baseUrl: string;
  apiKey: string;
  schedulerSecret?: string;
  runId?: string;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof globalThis.fetch;
}

export interface StepResult {
  step: string;
  ok: boolean;
  detail: string;
}

export interface AdoptionLoopReport {
  ok: boolean;
  version: string;
  run_id: string;
  base_url: string;
  steps: StepResult[];
  enroll_commitment: string | null;
  evidence_event_hash: string | null;
  receipt_id: string | null;
  receipt_manifest_verified: boolean;
  rail_key: string | null;
  settle_status: string | null;
  settle_live: boolean;
  console_severity: string | null;
  attestation_verified: boolean;
  attestation_chain_ok: boolean;
  tamper_rejected: boolean;
  tamper_flipped_hash: string | null;
}

const COMMITMENT_RE = /^[0-9a-f]{64}$/i;

export class AdoptionLoopError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: unknown) {
    super(message);
    this.name = "AdoptionLoopError";
  }
}

export function newRunId(): string {
  const rand = bytesToHex(crypto.getRandomValues(new Uint8Array(4)));
  return `${new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14)}-${rand}`;
}

async function request(
  cfg: LoopConfig,
  method: string,
  path: string,
  opts: { json?: unknown; bearer?: string; scheduler?: boolean } = {}
): Promise<{ status: number; body: any }> {
  const url = `${cfg.baseUrl.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  if (opts.scheduler && cfg.schedulerSecret) {
    headers["x-scheduler-secret"] = cfg.schedulerSecret;
  }
  const doFetch = cfg.fetchImpl ?? globalThis.fetch;
  let res: Response;
  try {
    res = await doFetch(url, { method, headers, body });
  } catch (err) {
    throw new AdoptionLoopError(
      `network error ${method} ${path}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  let parsed: any = null;
  try {
    parsed = res ? await res.json() : null;
  } catch {
    parsed = null;
  }
  return { status: res?.status ?? 0, body: parsed };
}

function expectOk(res: { status: number; body: any }, what: string): any {
  if (res.status < 200 || res.status >= 300) {
    const detail =
      typeof res.body === "object" && res.body !== null && typeof res.body.error === "string"
        ? res.body.error
        : res.status === 0
          ? "no response"
          : `HTTP ${res.status}`;
    throw new AdoptionLoopError(`${what}: ${detail}`, res.status, res.body);
  }
  return res.body;
}

/** Env-driven config with clear errors. */
export function configFromEnv(): LoopConfig {
  const baseUrl = (process.env.BASE_URL ?? "").trim();
  const apiKey = (process.env.API_KEY ?? "").trim();
  if (!baseUrl) throw new AdoptionLoopError("BASE_URL env is required");
  if (!apiKey) throw new AdoptionLoopError("API_KEY env is required");
  return { baseUrl, apiKey, schedulerSecret: process.env.SCHEDULER_SECRET };
}

// ── Orchestration ──

export interface RunAdoptionOptions {
  cron?: boolean;
}

/**
 * Runs the full adoption proof loop. Never throws on step failure: each step is recorded in
 * the report and `ok` is false only when the declared trust invariants fail.
 */
export async function runAdoptionLoop(
  cfg: LoopConfig,
  opts: RunAdoptionOptions = {}
): Promise<AdoptionLoopReport> {
  const runId = cfg.runId ?? newRunId();
  const steps: StepResult[] = [];
  const record = (step: string, ok: boolean, detail: string) => {
    steps.push({ step, ok, detail });
  };

  const report: AdoptionLoopReport = {
    ok: false,
    version: ADOPTION_LOOP_VERSION,
    run_id: runId,
    base_url: cfg.baseUrl,
    steps,
    enroll_commitment: null,
    evidence_event_hash: null,
    receipt_id: null,
    receipt_manifest_verified: false,
    rail_key: null,
    settle_status: null,
    settle_live: false,
    console_severity: null,
    attestation_verified: false,
    attestation_chain_ok: false,
    tamper_rejected: false,
    tamper_flipped_hash: null,
  };

  // ── Step 0 (--cron): prove the live LLM factory cadence ──
  if (opts.cron) {
    try {
      const disc = await request(cfg, "POST", "/api/v1/raillab/discover", {});
      expectOk(disc, "discover");
      record(
        "discover",
        true,
        `discovery scan ok (created=${disc.body?.created ?? "?"}, skipped=${disc.body?.skipped_duplicates ?? "?"})`
      );
    } catch (err) {
      record(
        "discover",
        false,
        err instanceof Error ? err.message : "discover failed"
      );
    }
    try {
      const tickRes = await request(cfg, "POST", "/api/v1/raillab/tick", {
        bearer: cfg.apiKey,
        scheduler: true,
      });
      expectOk(tickRes, "tick");
      record(
        "tick",
        true,
        `execution tick ok (dryRun=${tickRes.body?.dry_run ?? tickRes.body?.dryRun ?? "?"}, quarantined=${tickRes.body?.quarantined?.length ?? 0})`
      );
    } catch (err) {
      record(
        "tick",
        false,
        err instanceof Error ? err.message : "tick failed"
      );
    }
  }

  // ── Step a: enroll autonomous agent ──
  const agent = newKeypair();
  let commitment: string | null = null;
  try {
    const challenge = expectOk(
      await request(cfg, "POST", "/api/v1/passport/agents/autonomous/challenge", {
        json: { public_key: agent.publicKeyHex },
      }),
      "challenge"
    );
    const difficulty = Number(challenge.pow_difficulty ?? 6);
    const powNonce = solvePoW(String(challenge.challenge_nonce), difficulty);
    const proofSignature = signProvisionProof(
      agent.secretKey,
      String(challenge.challenge_nonce),
      powNonce,
      agent.publicKeyHex
    );
    const provision = expectOk(
      await request(cfg, "POST", "/api/v1/passport/agents/autonomous/provision", {
        json: {
          public_key: agent.publicKeyHex,
          challenge_nonce: String(challenge.challenge_nonce),
          pow_nonce: powNonce,
          signature: proofSignature,
          display_name: `adoption-loop-${runId}`,
          domain: "CODE_GENERATION",
        },
      }),
      "provision"
    );
    commitment = String(provision.subject_commitment ?? "");
    if (!COMMITMENT_RE.test(commitment)) {
      throw new AdoptionLoopError("provision did not return a 64-hex subject_commitment");
    }
    report.enroll_commitment = commitment;
    record("enroll", true, `agent enrolled (commitment ${commitment.slice(0, 12)}…)`);
  } catch (err) {
    record(
      "enroll",
      false,
      err instanceof Error ? err.message : "enroll failed"
    );
    report.ok = false;
    return report;
  }

  // ── Step b: post signed evidence ──
  const evidencePayload: Record<string, unknown> = {
    ref: "refs/heads/main",
    repository: { full_name: `sahel/adoption-loop-${runId}`, html_url: `${cfg.baseUrl}/docs/trust-console` },
    head_commit: {
      id: `deadbeef${"0".repeat(36)}`,
      message: `adoption loop evidence ${runId}`,
      url: `${cfg.baseUrl}/docs/trust-console`,
    },
  };
  const { signature: evidenceSignature, digest: evidenceDigest } = signEvidencePayload(
    agent.secretKey,
    evidencePayload
  );
  try {
    const ev = expectOk(
      await request(
        cfg,
        "POST",
        `/api/v1/passport/agents/${commitment}/evidence`,
        {
          json: {
            source_type: "github_push_webhook",
            payload: evidencePayload,
            signature: evidenceSignature,
          },
          bearer: cfg.apiKey,
        }
      ),
      "evidence"
    );
    const eventHash = String(ev.event_commitment_hash ?? "");
    if (!/^[0-9a-f]{64}$/i.test(eventHash)) {
      throw new AdoptionLoopError("evidence response missing event_commitment_hash");
    }
    report.evidence_event_hash = eventHash;
    record(
      "evidence",
      true,
      `evidence anchored (event_commitment_hash ${eventHash.slice(0, 12)}…; digest ${evidenceDigest.slice(0, 12)}…)`
    );
  } catch (err) {
    record(
      "evidence",
      false,
      err instanceof Error ? err.message : "evidence failed"
    );
  }

  // ── Step c: issue + finalize receipt, verify Ed25519 on public-manifest ──
  let receiptId: string | null = null;
  let manifestVerified = false;
  try {
    const issue = expectOk(
      await request(cfg, "POST", "/api/v1/receipts", {
        json: {
          agent_id: commitment,
          receipt_type: "competence",
          input_digest: report.evidence_event_hash ?? sha256Hex(`adoption-loop-${runId}`),
          authority_scope: "adoption-loop-proof",
          expiry: new Date(Date.now() + 30 * 86400_000).toISOString(),
          domain: "SYSTEM_INTEGRATION",
        },
        bearer: cfg.apiKey,
      }),
      "receipt issue"
    );
    receiptId = String(issue.receipt_id ?? issue.id ?? "");
    if (!receiptId) throw new AdoptionLoopError("receipt issue missing receipt_id");
    report.receipt_id = receiptId;

    const finalize = expectOk(
      await request(cfg, "POST", `/api/v1/receipts/${receiptId}/finalize`, {
        json: {
          status: "success",
          output_hash: sha256Hex(`adoption-loop-output-${runId}`),
        },
        bearer: cfg.apiKey,
      }),
      "receipt finalize"
    );
    const finalizeStatus = String(finalize.status ?? "");
    if (finalizeStatus !== "success" && finalizeStatus !== "finalized") {
      throw new AdoptionLoopError(`receipt finalize returned status '${finalizeStatus}'`);
    }

    const manifest = expectOk(
      await request(cfg, "GET", `/api/v1/receipts/${receiptId}/public-manifest`, {}),
      "public-manifest"
    );
    const contentHash = String(manifest.commitment_hash ?? "");
    const sig = String(manifest.signature ?? "");
    const pub = String(manifest.public_key ?? "");
    if (!/^[0-9a-f]{64}$/i.test(contentHash) || !/^[0-9a-f]{128}$/i.test(sig)) {
      throw new AdoptionLoopError("public-manifest missing commitment_hash/signature");
    }
    if (!pub || !/^[0-9a-f]{64}$/i.test(pub)) {
      throw new AdoptionLoopError("public-manifest missing a 64-hex public_key");
    }
    manifestVerified = await verify(
      hexToBytes(sig),
      utf8ToBytes(contentHash),
      hexToBytes(pub)
    );
    if (!manifestVerified) {
      throw new AdoptionLoopError("public-manifest Ed25519 signature did NOT verify offline");
    }
    report.receipt_manifest_verified = true;
    record(
      "receipt",
      true,
      `receipt ${receiptId} issued+finalized; manifest Ed25519 verified offline`
    );
  } catch (err) {
    record(
      "receipt",
      false,
      err instanceof Error ? err.message : "receipt failed"
    );
  }

  // ── Step d: provision canary rail + settle (signature-gated) ──
  const canaryKeypair = newKeypair();
  const railKey = `adopt-${runId}`;
  try {
    const spec = expectOk(
      await request(cfg, "POST", "/api/v1/raillab/specs", {
        json: {
          rail_key: railKey,
          name: `Adoption Canary ${runId}`,
          category: "PAYMENT",
          provider_key: "agent_api",
          ledger_kind: "ANGEL",
          kyc_tier: "NONE",
          fee_bps: 0,
          signer_commitment: canaryKeypair.publicKeyHex,
        },
        bearer: cfg.apiKey,
      }),
      "provision canary rail"
    );
    report.rail_key = String(spec.rail_key ?? railKey);
    record("provision_rail", true, `canary rail ${report.rail_key} ENABLED (dry-run safe)`);
  } catch (err) {
    record(
      "provision_rail",
      false,
      err instanceof Error ? err.message : "provision canary failed"
    );
  }

  if (report.rail_key) {
    const reference = `adopt-${runId}-settle`;
    const settlePayload: Record<string, unknown> = {
      external_reference: reference,
      amount: 3000,
      fx_rate_usd: 1.0,
    };
    const settleSignature = signSettlementPayload(canaryKeypair.secretKey, settlePayload);
    try {
      const settle = expectOk(
        await request(cfg, "POST", "/api/v1/raillab/settle", {
          json: {
            rail_key: report.rail_key,
            reference,
            payload: settlePayload,
            signature: settleSignature,
            public_key: canaryKeypair.publicKeyHex,
          },
          bearer: cfg.apiKey,
        }),
        "settle"
      );
      report.settle_status = String(settle.status ?? "");
      report.settle_live = Boolean(settle.live);
      if (report.settle_status !== "SETTLED") {
        throw new AdoptionLoopError(
          `settle returned status '${report.settle_status}' (expected SETTLED)`
        );
      }
      record(
        "settle",
        true,
        `settlement ${report.settle_status} via /settle (signature-gated) live=${report.settle_live}`
      );
    } catch (err) {
      record(
        "settle",
        false,
        err instanceof Error ? err.message : "settle failed"
      );
    }
  }

  // ── Step e: trust console severity ──
  try {
    const console = expectOk(
      await request(cfg, "GET", "/api/v1/raillab/console", { bearer: cfg.apiKey }),
      "trust console"
    );
    const severity = String(console.console?.severity ?? "");
    report.console_severity = severity;
    const ok = severity === "OK" || severity === "WARNING";
    if (!ok) {
      throw new AdoptionLoopError(
        `console severity '${severity}' is not OK/WARNING (trust is in a SEVERE state)`
      );
    }
    record(
      "console",
      true,
      `trust console severity ${severity} (attestation verified=${console.console?.attestation?.verified ?? "?"})`
    );
  } catch (err) {
    record(
      "console",
      false,
      err instanceof Error ? err.message : "console failed"
    );
  }

  // ── Step f: offline-verify LATEST attestation ──
  let latestSigned: Record<string, unknown> | null = null;
  try {
    const latest = expectOk(
      await request(cfg, "GET", "/api/v1/raillab/health/attestations/latest", {}),
      "latest attestation"
    );
    const raw = latest.attestation;
    if (!raw || typeof raw !== "object") {
      throw new AdoptionLoopError("no attestation available yet");
    }
    const item = {
      attestationId: String(raw.attestation_id ?? ""),
      checkedAt: String(raw.checked_at ?? ""),
      ok: Boolean(raw.ok),
      supplyConsistent: Boolean(raw.supply_consistent),
      fractionalConsistent: Boolean(raw.fractional_consistent),
      lpInvariantOk: Boolean(raw.lp_invariant_ok),
      pendingReviewStale: Number(raw.pending_review_stale ?? 0),
      settledTotalCredited: Number(raw.settled_total_credited ?? 0),
      settledTotalRows: Number(raw.settled_total_rows ?? 0),
      issues: Array.isArray(raw.issues) ? (raw.issues as string[]) : [],
      prevAttestationHash: raw.prev_attestation_hash ?? null,
      attestationHash: String(raw.attestation_hash ?? ""),
      signature: String(raw.signature ?? ""),
      publicKey: raw.public_key ?? null,
      algorithm: String(raw.algorithm ?? "ed25519"),
    };
    latestSigned = item as unknown as Record<string, unknown>;
    const check = await verifyAttestationOffline(item);
    report.attestation_verified = check.valid;
    report.attestation_chain_ok = Boolean(raw.prev_attestation_hash !== null);
    if (!check.valid) {
      throw new AdoptionLoopError(
        `attestation ${item.attestationId.slice(0, 12)}… offline verify FAILED: ${check.reason ?? "unknown"}`
      );
    }
    record(
      "attestation",
      true,
      `attestation ${item.attestationId.slice(0, 12)}… hash+signature verified offline (public key ${(item.publicKey ?? "").slice(0, 12)}…)`
    );
  } catch (err) {
    record(
      "attestation",
      false,
      err instanceof Error ? err.message : "attestation verify failed"
    );
  }

  // ── Step g: tamper-check → /verify must return false ──
  if (latestSigned && typeof latestSigned === "object") {
    const originalHash = String(latestSigned.attestationHash ?? "");
    const flipped = flipAttestationHash(originalHash);
    report.tamper_flipped_hash = flipped;
    try {
      const tampered = { ...latestSigned, attestationHash: flipped };
      const verifyRes = await request(cfg, "POST", "/api/v1/raillab/health/attestations/verify", {
        json: tampered,
      });
      const valid = verifyRes.status < 400 && Boolean(verifyRes.body?.valid);
      report.tamper_rejected = !valid;
      record(
        "tamper",
        report.tamper_rejected,
        report.tamper_rejected
          ? `flipped one byte of attestation hash → /verify rejected (valid=${valid})`
          : `tampered attestation was NOT rejected (valid=${valid})`
      );
    } catch (err) {
      report.tamper_rejected = false;
      record(
        "tamper",
        false,
        err instanceof Error ? err.message : "tamper check failed"
      );
    }
  } else {
    report.tamper_rejected = false;
    record("tamper", false, "skipped: no attestation to tamper-check");
  }

  // ── Summarize ──
  const allStepsOk = steps.every((s) => s.ok);
  report.ok = allStepsOk && report.attestation_verified && report.tamper_rejected;
  return report;
}

async function main(): Promise<never> {
  const args = process.argv.slice(2);
  const cron = args.includes("--cron");
  const help = args.includes("--help") || args.includes("-h");

  if (help) {
    console.log("ASMC-3 Phase 26 — Adoption Proof Loop");
    console.log("Usage: ADOPTION_LOOP_RUN=1 npx tsx scripts/adoption-loop.ts [--cron]");
    console.log("  --cron   run discovery + one health tick before the loop (proves live LLM cadence)");
    console.log("Env: BASE_URL (required), API_KEY (required), SCHEDULER_SECRET (optional)");
    process.exit(0);
  }

  let cfg: LoopConfig;
  try {
    cfg = configFromEnv();
  } catch (err) {
    console.error(
      `✗ ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(2);
  }

  try {
    const report = await runAdoptionLoop(cfg, { cron });
    console.log(JSON.stringify(report, null, 2));
    if (report.ok) {
      console.log("\n✔ Adoption proof loop PASSED — the palette runs end-to-end.");
      process.exit(0);
    }
    console.error("\n✗ Adoption proof loop FAILED — see report steps above.");
    process.exit(1);
  } catch (err) {
    console.error(`✗ Adoption proof loop crashed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(3);
  }
}

const IS_MAIN = (() => {
  try {
    return process.env.ADOPTION_LOOP_RUN === "1";
  } catch {
    return false;
  }
})();

if (IS_MAIN) {
  void main();
}