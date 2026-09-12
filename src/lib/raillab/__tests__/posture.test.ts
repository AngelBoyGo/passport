/**
 * Fail-Closed System Posture & Readiness tests (Phase 30).
 *
 * The meta-test: for EVERY surface, a throwing/unreadable dependency must never yield
 * severity OK. Also covers composition mapping, readiness blockers (without leaking secrets),
 * offline snapshot verification, and the per-source timeout.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { verify } from "@noble/ed25519";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getExecutionSafetyFlag: vi.fn(),
    getLatestAttestation: vi.fn(),
    verifyIntegrityAttestation: vi.fn(),
    getIntegrityPublicKeyHex: vi.fn(),
    buildTrustConsole: vi.fn(),
    buildLighthouse: vi.fn(),
    buildResilience: vi.fn(),
    queryRawUnsafe: vi.fn(),
    integrityAttestationFindUnique: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRawUnsafe: mocks.queryRawUnsafe,
    integrityAttestation: { findUnique: mocks.integrityAttestationFindUnique },
  },
}));
vi.mock("../breach-response", () => ({ getExecutionSafetyFlag: mocks.getExecutionSafetyFlag }));
vi.mock("../attest", () => ({
  getLatestAttestation: mocks.getLatestAttestation,
  verifyIntegrityAttestation: mocks.verifyIntegrityAttestation,
  getIntegrityPublicKeyHex: mocks.getIntegrityPublicKeyHex,
}));
vi.mock("../console", () => ({ buildTrustConsole: mocks.buildTrustConsole }));
vi.mock("../lighthouse", () => ({ buildLighthouse: mocks.buildLighthouse }));
vi.mock("../resilience", () => ({ buildResilience: mocks.buildResilience }));

import {
  buildPosture,
  computeReadiness,
  postureCacheControl,
  type BuildPostureOptions,
} from "../posture";
import { canonicalJson, sha256Hex } from "../../receipt/canonical";

const FULL_ENV: Record<string, string> = {
  DATABASE_URL: "postgresql://user:pass@host:5432/db",
  SIGNING_PRIVATE_KEY: "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
  INGESTION_COMMITMENT_SALT: "salt",
  SESSION_SECRET: "session",
  SCHEDULER_SECRET: "SCHED_SECRET_9f3a_distinct",
};
const PROD: BuildPostureOptions = { env: { ...FULL_ENV }, nodeEnv: "production" };

function healthy() {
  mocks.getExecutionSafetyFlag.mockResolvedValue({
    halted: false,
    haltedAt: null,
    reason: null,
    causedByAttestationId: null,
    version: 1,
  });
  mocks.getLatestAttestation.mockResolvedValue({
    attestationId: "attest_1",
    checkedAt: new Date("2026-01-01T00:00:00.000Z"),
    ok: true,
    supplyConsistent: true,
    fractionalConsistent: true,
    lpInvariantOk: true,
    pendingReviewStale: 0,
    settledTotalCredited: 0,
    settledTotalRows: 0,
    issues: [],
    prevAttestationHash: null,
    attestationHash: "a".repeat(64),
    signature: "b".repeat(128),
    publicKey: "c".repeat(64),
  });
  mocks.verifyIntegrityAttestation.mockResolvedValue({ valid: true });
  mocks.getIntegrityPublicKeyHex.mockReturnValue("c".repeat(64));
  mocks.buildTrustConsole.mockResolvedValue({ severity: "OK", degraded: false });
  mocks.buildLighthouse.mockResolvedValue({
    lighthouse: { degraded: false, persistence: { integrity: { suspicious: false } } },
  });
  mocks.buildResilience.mockResolvedValue({
    resilience: { summary: { severity: "OK", survives: true }, degraded: false },
  });
  mocks.queryRawUnsafe.mockResolvedValue([{ ok: 1 }]);
  mocks.integrityAttestationFindUnique.mockResolvedValue(null);
}

describe("Fail-Closed System Posture (Phase 30)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    healthy();
  });

  describe("composition severity mapping (a)", () => {
    it("OK when every surface is healthy and the deployment is ready", async () => {
      const res = await buildPosture(new Date(), PROD);
      expect(res.posture.severity).toBe("OK");
      expect(res.posture.ready).toBe(true);
      expect(res.posture.degraded).toBe(false);
    });

    it.each([
      ["console degraded", () => mocks.buildTrustConsole.mockResolvedValue({ severity: "OK", degraded: true })],
      ["lighthouse degraded", () => mocks.buildLighthouse.mockResolvedValue({ lighthouse: { degraded: true, persistence: { integrity: { suspicious: false } } } })],
      ["resilience WARNING", () => mocks.buildResilience.mockResolvedValue({ resilience: { summary: { severity: "WARNING", survives: true }, degraded: false } })],
    ])("WARNING when %s", async (_name, setup) => {
      setup();
      const res = await buildPosture(new Date(), PROD);
      expect(res.posture.severity).toBe("WARNING");
    });

    it.each([
      ["attestation unverified", () => mocks.verifyIntegrityAttestation.mockResolvedValue({ valid: false })],
      ["safety halted", () => mocks.getExecutionSafetyFlag.mockResolvedValue({ halted: true, haltedAt: new Date(), reason: "breach", causedByAttestationId: "a", version: 2 })],
      ["console SEVERE", () => mocks.buildTrustConsole.mockResolvedValue({ severity: "SEVERE", degraded: false })],
      ["lighthouse suspicious", () => mocks.buildLighthouse.mockResolvedValue({ lighthouse: { degraded: false, persistence: { integrity: { suspicious: true } } } })],
      ["resilience SEVERE", () => mocks.buildResilience.mockResolvedValue({ resilience: { summary: { severity: "SEVERE", survives: false }, degraded: false } })],
    ])("SEVERE when %s", async (_name, setup) => {
      setup();
      const res = await buildPosture(new Date(), PROD);
      expect(res.posture.severity).toBe("SEVERE");
    });
  });

  describe("readiness (b)", () => {
    it("is not ready (and leaks no secret) when required env is missing in production", async () => {
      const env = { ...FULL_ENV };
      delete env.SESSION_SECRET;
      const res = await buildPosture(new Date(), { env, nodeEnv: "production" });
      expect(res.posture.ready).toBe(false);
      expect(res.posture.blockers).toContain("required_env");
      expect(res.posture.severity).toBe("SEVERE");
      // secret VALUES (present or absent) must never appear in the output
      expect(JSON.stringify(res)).not.toContain(FULL_ENV.SIGNING_PRIVATE_KEY!);
      expect(JSON.stringify(res)).not.toContain(FULL_ENV.SCHEDULER_SECRET!);
    });

    it("blocks on an invalid signing key and on an unset scheduler secret (production)", () => {
      const r1 = computeReadiness({
        env: { ...FULL_ENV, SIGNING_PRIVATE_KEY: "not-hex" },
        nodeEnv: "production",
        dbReachable: true,
        migrationsApplied: true,
      });
      expect(r1.blockers).toContain("signing_key");

      const r2 = computeReadiness({
        env: { ...FULL_ENV, SCHEDULER_SECRET: "" },
        nodeEnv: "production",
        dbReachable: true,
        migrationsApplied: true,
      });
      expect(r2.blockers).toContain("scheduler_secret");
    });

    it("treats missing required env as advisory (not blocking) outside production", () => {
      const r = computeReadiness({
        env: {},
        nodeEnv: "development",
        dbReachable: true,
        migrationsApplied: true,
      });
      // database + migrations are blocking; they are healthy here
      expect(r.ready).toBe(true);
      expect(r.blockers).toEqual([]);
    });

    it("blocks when the database is unreachable or migrations are missing", () => {
      const r = computeReadiness({
        env: { ...FULL_ENV },
        nodeEnv: "production",
        dbReachable: false,
        migrationsApplied: false,
      });
      expect(r.blockers).toEqual(expect.arrayContaining(["database", "migrations"]));
    });
  });

  describe("FAIL-CLOSED GUARD: no surface may silently read OK (c)", () => {
    const cases: [string, () => void][] = [
      ["attestation", () => mocks.getLatestAttestation.mockRejectedValue(new Error("attest down"))],
      ["safety", () => mocks.getExecutionSafetyFlag.mockRejectedValue(new Error("safety down"))],
      ["console", () => mocks.buildTrustConsole.mockRejectedValue(new Error("console down"))],
      ["lighthouse", () => mocks.buildLighthouse.mockRejectedValue(new Error("lighthouse down"))],
      ["resilience", () => mocks.buildResilience.mockRejectedValue(new Error("resilience down"))],
      ["database", () => mocks.queryRawUnsafe.mockRejectedValue(new Error("db down"))],
    ];
    it.each(cases)("never yields OK when %s throws", async (_name, setup) => {
      setup();
      const res = await buildPosture(new Date(), PROD);
      expect(res.posture.severity).not.toBe("OK");
      // The degradation is visible either as a surface error or as a readiness blocker
      // (the DB probe reports through readiness rather than degraded_reasons).
      expect(res.posture.degraded || res.posture.blockers.length > 0).toBe(true);
      expect(
        res.posture.degraded_reasons.length + res.posture.blockers.length
      ).toBeGreaterThan(0);
    });
  });

  describe("snapshot + timeout (d)", () => {
    it("signs the report and verifies offline", async () => {
      const res = await buildPosture(new Date("2026-06-15T12:00:00.000Z"), PROD);
      const { snapshot, ...signed } = res;
      const recomputed = sha256Hex(canonicalJson(signed as unknown as Record<string, unknown>));
      expect(recomputed).toBe(snapshot.content_hash);
      const valid = verify(
        hexToBytes(snapshot.signature),
        utf8ToBytes(recomputed),
        hexToBytes(snapshot.public_key)
      );
      expect(valid).toBe(true);
    });

    it("returns a degraded (never OK) report when one source is slow", async () => {
      mocks.buildLighthouse.mockReturnValue(new Promise(() => {})); // never resolves
      const res = await buildPosture(new Date(), { ...PROD, timeoutMs: 20 });
      expect(res.posture.degraded).toBe(true);
      expect(res.posture.degraded_reasons.join(" ")).toContain("timed out");
      expect(res.posture.severity).not.toBe("OK");
    });

    it("cache policy is private and never caches a non-OK or degraded report", () => {
      expect(postureCacheControl(false, "OK")).toBe("private, max-age=60");
      expect(postureCacheControl(true, "OK")).toBe("private, no-store, max-age=0");
      expect(postureCacheControl(false, "WARNING")).toBe("private, no-store, max-age=0");
      expect(postureCacheControl(false, "SEVERE")).toBe("private, no-store, max-age=0");
    });
  });
});