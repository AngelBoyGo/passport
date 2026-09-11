/**
 * Adoption Proof Loop tests (Phase 26) — mock-fetch contract coverage.
 *
 * The runbook is HTTP-only; these tests replace `fetch` with an in-memory scripted server so
 * the full loop (enroll → evidence → receipt → rail → settle → console → attestation →
 * tamper) is exercised deterministically. Options:
 *
 *   1. happy path                 — every endpoint responds correctly → ok:true, exit gate true
 *   2. per-step failure           — any single step 500s → that step ok:false, report.ok:false
 *   3. tamper-rejection           — /verify returns valid:false for the flipped hash
 *   4. idempotent re-run          — same run id twice → same references, no duplicate mint
 *   5. --cron                     — discover + tick called first
 */
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  flipAttestationHash,
  hashIntegrityAttestation,
  newRunId,
  runAdoptionLoop,
  sha256Hex,
  signEvidencePayload,
  signProvisionProof,
  signSettlementPayload,
  solvePoW,
  verifyAttestationOffline,
} from "../adoption-loop";

import { keygen, sign, verify } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";

const BASE_URL = "https://passport.example.com";
const API_KEY = "pp_issuer_testkey";

// ── Mock server ──

type Handler = (url: string, init: RequestInit, calls: { url: string; init: RequestInit }[]) => {
  status: number;
  json?: unknown;
  text?: string;
};

function jsonResponse(status: number, json: unknown) {
  return new Response(JSON.stringify(json), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Builds a scripted fetch that records calls and dispatches to `handler`. */
function dispatchFetch(
  handler: Handler
): { fetchImpl: typeof globalThis.fetch; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: any, init: any) => {
    calls.push({ url: String(url), init: init ?? {} });
    const method = (init?.method ?? "GET").toUpperCase();
    const path = String(url).replace(BASE_URL, "");
    const result = handler(path, { ...init, method }, calls);
    if (result instanceof Response) return result;
    const text = result.json !== undefined
      ? JSON.stringify(result.json)
      : result.text ?? "";
    return new Response(text, {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetchImpl, calls };
}

// ── Fixtures ──

interface AttestationFixture {
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
  publicKey: string;
}

/** Builds a cryptographically valid signed attestation fixture. */
async function signedAttestation(): Promise<AttestationFixture> {
  const { secretKey, publicKey } = keygen();
  const publicKeyHex = bytesToHex(publicKey);
  const body = {
    attestationId: "attest_fixture_0001",
    checkedAt: new Date().toISOString(),
    ok: true,
    supplyConsistent: true,
    fractionalConsistent: true,
    lpInvariantOk: true,
    pendingReviewStale: 0,
    settledTotalCredited: 42,
    settledTotalRows: 7,
    issues: [] as string[],
    prevAttestationHash: null as string | null,
  };
  const attestationHash = hashIntegrityAttestation(body);
  const signature = bytesToHex(sign(utf8ToBytes(attestationHash), secretKey));
  return { ...body, attestationHash, signature, publicKey: publicKeyHex };
}

function attestationRouteShape(a: AttestationFixture) {
  return {
    attestation_id: a.attestationId,
    checked_at: a.checkedAt,
    ok: a.ok,
    supply_consistent: a.supplyConsistent,
    fractional_consistent: a.fractionalConsistent,
    lp_invariant_ok: a.lpInvariantOk,
    pending_review_stale: a.pendingReviewStale,
    settled_total_credited: a.settledTotalCredited,
    settled_total_rows: a.settledTotalRows,
    issues: a.issues,
    prev_attestation_hash: a.prevAttestationHash,
    attestation_hash: a.attestationHash,
    signature: a.signature,
    public_key: a.publicKey,
    algorithm: "ed25519",
  };
}

/** Default happy-path handler that models every endpoint the runbook calls. */
function happyHandler(attestation: AttestationFixture): Handler {
  return (path, init) => {
    const body = (() => {
      if (!init.body || typeof init.body !== "string") return {};
      try {
        return JSON.parse(init.body);
      } catch {
        return {};
      }
    })();
    switch (true) {
      case path === "/api/v1/raillab/discover":
        return { status: 200, json: { success: true, created: 0, skipped_duplicates: 1, source_errors: [] } };
      case path === "/api/v1/raillab/tick":
        return { status: 200, json: { success: true, executed: 0, dryRun: 1, failed: 0, quarantined: [] } };
      case path === "/api/v1/passport/agents/autonomous/challenge" && init.method === "POST":
        return {
          status: 200,
          json: {
            challenge_nonce: "cafef00d".padEnd(64, "0"),
            pow_difficulty: 1,
            expires_at: new Date(Date.now() + 120000).toISOString(),
          },
        };
      case path === "/api/v1/passport/agents/autonomous/provision" && init.method === "POST": {
        const commitment = sha256Hex(`${body.public_key}:adoption`);
        return { status: 201, json: { success: true, subject_commitment: commitment, role: "HOLDER" } };
      }
      case /\/api\/v1\/passport\/agents\/[0-9a-f]{64}\/evidence$/.test(path) && init.method === "POST":
        return {
          status: 201,
          json: {
            event_commitment_hash: sha256Hex(`event:${JSON.stringify(body.payload)}`),
            enrollment_status: "ENROLLED",
          },
        };
      case path === "/api/v1/receipts" && init.method === "POST":
        return {
          status: 201,
          json: {
            receipt_id: "rec_test_0001",
            status: "pending",
            agent_id: body.agent_id,
            receipt_type: body.receipt_type,
            signature: "00".repeat(64) as unknown,
          },
        };
      case path === "/api/v1/receipts/rec_test_0001/finalize" && init.method === "POST":
        return { status: 200, json: { receipt_id: "rec_test_0001", status: "success" } };
      case path === "/api/v1/receipts/rec_test_0001/public-manifest":
        return {
          status: 200,
          json: {
            receipt_id: "rec_test_0001",
            commitment_hash: sha256Hex("manifest-content"),
            signature: bytesToHex(sign(utf8ToBytes(sha256Hex("manifest-content")), secretForTest())),
            public_key: bytesToHex(getPublicForTest()),
            verification_status: "verified",
          },
        };
      case path === "/api/v1/raillab/specs" && init.method === "POST":
        return { status: 200, json: { success: true, id: "spec_canary_1", rail_key: body.rail_key, state: "ENABLED" } };
      case path === "/api/v1/raillab/settle" && init.method === "POST":
        return {
          status: 201,
          json: { success: true, settlement_id: "RS-test", rail_key: body.rail_key, status: "SETTLED", live: false, credited_angel: 5, error_tranche: "NONE" },
        };
      case path === "/api/v1/raillab/console":
        return {
          status: 200,
          json: {
            success: true,
            console: {
              safety: { halted: false, halted_at: null, reason: null, caused_by_attestation_id: null, version: 1 },
              attestation: { verified: attestation.ok, chain_ok: true, prev_linked: false, issues: [] },
              rails: { total: 1, enabled: 1, quarantined: 0, by_kind: { ANGEL: 1 }, velocity_alerts: [], pending_review_stale: 0 },
              severity: "OK",
              generated_at: new Date().toISOString(),
            },
          },
        };
      case path === "/api/v1/raillab/health/attestations/latest":
        return { status: 200, json: { success: true, attestation: attestationRouteShape(attestation) } };
      case path === "/api/v1/raillab/health/attestations/verify" && init.method === "POST":
        return {
          status: 200,
          json: { valid: body.attestation_hash === attestation.attestationHash, reason: "ok" },
        };
      default:
        return { status: 404, json: { error: `no mock route for ${init.method} ${path}` } };
    }
  };
}

let _sigKey: Uint8Array | null = null;
let _pubKey: Uint8Array | null = null;
function secretForTest(): Uint8Array {
  if (!_sigKey) {
    const k = keygen();
    _sigKey = k.secretKey;
    _pubKey = k.publicKey;
  }
  return _sigKey;
}
function getPublicForTest(): Uint8Array {
  secretForTest();
  return _pubKey as Uint8Array;
}

const cfg = { baseUrl: BASE_URL, apiKey: API_KEY, runId: "20260911120000-abcdef01" };

// ── Tests ──

describe("adoption-loop runbook", () => {
  it("happy path: every step passes and report.ok is true", async () => {
    const attestation = await signedAttestation();
    const { fetchImpl, calls } = dispatchFetch(happyHandler(attestation));
    const report = await runAdoptionLoop({ ...cfg, fetchImpl }, {});
    expect(report.ok).toBe(true);
    for (const step of report.steps) {
      expect(step.ok).toBe(true);
    }
    expect(report.enroll_commitment).toMatch(/^[0-9a-f]{64}$/i);
    expect(report.evidence_event_hash).toMatch(/^[0-9a-f]{64}$/i);
    expect(report.receipt_manifest_verified).toBe(true);
    expect(report.rail_key).toBe(`adopt-${cfg.runId}`);
    expect(report.settle_status).toBe("SETTLED");
    expect(report.console_severity).toBe("OK");
    expect(report.attestation_verified).toBe(true);
    expect(report.tamper_rejected).toBe(true);
    expect(calls.map((c) => c.url)).toContain(`${BASE_URL}/api/v1/raillab/console`);
  });

  it("per-step failure: a failing settle yields ok:false and reports it", async () => {
    const attestation = await signedAttestation();
    const base = happyHandler(attestation);
    const { fetchImpl, calls } = dispatchFetch((path, init) => {
      if (path === "/api/v1/raillab/settle") {
        return { status: 500, json: { error: "flaky settle" } };
      }
      return base(path, init, calls);
    });
    const report = await runAdoptionLoop({ ...cfg, fetchImpl }, {});
    const settle = report.steps.find((s) => s.step === "settle");
    expect(settle?.ok).toBe(false);
    expect(report.ok).toBe(false);
    expect(settle?.detail).toContain("flaky settle");
  });

  it("per-step failure: a SEVERE console fails the loop", async () => {
    const attestation = await signedAttestation();
    const base = happyHandler(attestation);
    const { fetchImpl, calls } = dispatchFetch((path, init) => {
      if (path === "/api/v1/raillab/console") {
        return {
          status: 200,
          json: {
            success: true,
            console: {
              safety: { halted: true, halted_at: new Date().toISOString(), reason: "integrity breach", caused_by_attestation_id: "attest_x", version: 2 },
              attestation: { verified: false, chain_ok: true, prev_linked: false, issues: ["integrity breach"] },
              rails: { total: 1, enabled: 1, quarantined: 0, by_kind: { ANGEL: 1 }, velocity_alerts: [], pending_review_stale: 0 },
              severity: "SEVERE",
              generated_at: new Date().toISOString(),
            },
          },
        };
      }
      return base(path, init, calls);
    });
    const report = await runAdoptionLoop({ ...cfg, fetchImpl }, {});
    const consoleStep = report.steps.find((s) => s.step === "console");
    expect(consoleStep?.ok).toBe(false);
    expect(report.console_severity).toBe("SEVERE");
    expect(report.ok).toBe(false);
  });

  it("tamper-rejection: /verify returns false for the flipped hash (server-side check)", async () => {
    const attestation = await signedAttestation();
    const { fetchImpl, calls } = dispatchFetch(happyHandler(attestation));
    const report = await runAdoptionLoop({ ...cfg, fetchImpl }, {});
    expect(report.tamper_rejected).toBe(true);
    expect(report.tamper_flipped_hash).not.toBe(attestation.attestationHash);
    // The mock truly rejected: the flipped hash ≠ real hash, so valid=false.
    expect(report.attestation_verified).toBe(true);
  });

  it("idempotent re-run: same runId reuses the same rail + references (no duplicates)", async () => {
    const attestation = await signedAttestation();
    const { fetchImpl, calls: calls1 } = dispatchFetch(happyHandler(attestation));
    const first = await runAdoptionLoop({ ...cfg, fetchImpl }, {});
    const { fetchImpl: fetchImpl2, calls: calls2 } = dispatchFetch(happyHandler(attestation));
    const second = await runAdoptionLoop({ ...cfg, fetchImpl: fetchImpl2 }, {});
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.run_id).toBe(second.run_id);
    // The canary rail + settlement reference are run-tagged and deterministic.
    expect(first.rail_key).toBe(second.rail_key);
    expect(first.rail_key).toContain(cfg.runId!);
    const settleRefs1 = calls1.filter((c) => c.url.endsWith("/api/v1/raillab/settle"));
    const settleRefs2 = calls2.filter((c) => c.url.endsWith("/api/v1/raillab/settle"));
    expect(settleRefs1.length).toBe(1);
    expect(settleRefs2.length).toBe(1);
    const toRef = (init: RequestInit) => JSON.parse(init.body as string).reference as string;
    expect(toRef(settleRefs1[0]!.init)).toBe(toRef(settleRefs2[0]!.init));
  });

  it("--cron runs discover + tick before the loop", async () => {
    const attestation = await signedAttestation();
    const { fetchImpl, calls } = dispatchFetch(happyHandler(attestation));
    const report = await runAdoptionLoop({ ...cfg, fetchImpl }, { cron: true });
    expect(report.ok).toBe(true);
    const firstTwo = calls.slice(0, 2).map((c) => c.url);
    expect(firstTwo[0]?.includes("/api/v1/raillab/discover")).toBe(true);
    expect(firstTwo[1]?.includes("/api/v1/raillab/tick")).toBe(true);
  });

  it("missing attestation yields attestation step ok:false and report.ok false", async () => {
    const attestation = await signedAttestation();
    const base = happyHandler(attestation);
    const { fetchImpl, calls } = dispatchFetch((path, init) => {
      if (path === "/api/v1/raillab/health/attestations/latest") {
        return { status: 200, json: { success: true, attestation: null } };
      }
      return base(path, init, calls);
    });
    const report = await runAdoptionLoop({ ...cfg, fetchImpl }, {});
    expect(report.attestation_verified).toBe(false);
    expect(report.ok).toBe(false);
  });
});

// ── Pure crypto unit coverage ──

describe("adoption-loop crypto helpers", () => {
  it("newRunId is unique and parseable", () => {
    const a = newRunId();
    const b = newRunId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });

  it("solvePoW yields a hash with the leading-zero target", () => {
    const nonce = "beef".padEnd(64, "0");
    for (const difficulty of [0, 1, 2]) {
      const pow = solvePoW(nonce, difficulty);
      const digest = sha256Hex(`${nonce}:${pow}`);
      expect(digest.startsWith("0".repeat(difficulty))).toBe(true);
    }
  });

  it("signProvisionProof verifies against the server's message bytes", () => {
    // provisionAutonomousAgent verifies: verify(sig, sha256(`${nonce}:${pow}:${pub}`) BYTES, pub)
    const k = keygen();
    const pubHex = bytesToHex(k.publicKey);
    const nonce = "ca11".padEnd(64, "0");
    const pow = "7";
    const sigHex = signProvisionProof(k.secretKey, nonce, pow, pubHex);
    const digest = sha256(utf8ToBytes(`${nonce}:${pow}:${pubHex}`));
    expect(verifySig(hexToBytes(sigHex), digest, k.publicKey)).toBe(true);
  });

  it("signEvidencePayload signature verifies over utf8(digest)", () => {
    const k = keygen();
    const payload = { ref: "refs/heads/main", n: 1 };
    const { signature, digest } = signEvidencePayload(k.secretKey, payload);
    expect(verifySig(hexToBytes(signature), utf8ToBytes(digest), k.publicKey)).toBe(true);
    expect(digest).toBe(sha256Hex(canonicalJson(payload)));
  });

  it("signSettlementPayload verifies over utf8(canonicalJson(payload))", () => {
    const k = keygen();
    const payload = { external_reference: "adopt-1", amount: 3000 };
    const sig = signSettlementPayload(k.secretKey, payload);
    expect(verifySig(hexToBytes(sig), utf8ToBytes(canonicalJson(payload)), k.publicKey)).toBe(true);
  });

  it("verifyAttestationOffline accepts a well-formed attestation and rejects a tampered one", async () => {
    const a = await signedAttestation();
    const check = await verifyAttestationOffline(a);
    expect(check.valid).toBe(true);
    const tampered = { ...a, ok: !a.ok };
    const bad = await verifyAttestationOffline(tampered);
    expect(bad.valid).toBe(false);
    expect(bad.reason).toContain("hash mismatch");
  });

  it("verifyAttestationOffline rejects a missing public key (legacy row)", async () => {
    const a = await signedAttestation();
    const legacy = { ...a, publicKey: null };
    const check = await verifyAttestationOffline(legacy);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain("missing signature or public key");
  });

  it("hashIntegrityAttestation is deterministic and key-sorted", () => {
    const body = {
      attestationId: "a1",
      checkedAt: "2026-01-01T00:00:00.000Z",
      ok: true,
      supplyConsistent: true,
      fractionalConsistent: true,
      lpInvariantOk: true,
      pendingReviewStale: 0,
      settledTotalCredited: 0,
      settledTotalRows: 0,
      issues: [] as string[],
    };
    const h1 = hashIntegrityAttestation(body);
    const h2 = hashIntegrityAttestation({ ...body });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("flipAttestationHash changes exactly the first nibble", () => {
    const h = "0".repeat(64);
    const flipped = flipAttestationHash(h);
    expect(flipped).toBe("1" + h.slice(1));
  });
});

function verifySig(
  sig: Uint8Array,
  msg: Uint8Array,
  pub: Uint8Array
): boolean {
  return verify(sig, msg, pub);
}