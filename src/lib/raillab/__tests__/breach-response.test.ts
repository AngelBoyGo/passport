import { describe, it, expect, vi, beforeEach } from "vitest";
import { sign, getPublicKey } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJson } from "@/lib/receipt/canonical";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    integrityAttestation: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    executionSafetyFlag: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    railSignerKey: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    breachResponse: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    railSpec: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    railSettlement: { findMany: vi.fn(), create: vi.fn() },
    railTelemetry: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    adminAuditLog: { create: vi.fn() },
    agentWallet: { findMany: vi.fn() },
    commodityLiquidityPool: { findMany: vi.fn() },
    vaultBatch: { findMany: vi.fn() },
    fractionalCommodityBalance: { findMany: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  classifyBreach,
  respondToBreach,
  verifyBreachResponse,
  getExecutionSafetyFlag,
  clearHaltIfHealthy,
  rotateSignerKey,
  resolveLegacyOrEraKey,
} from "../breach-response";

const SEED = hexToBytes("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20");

function pendingStaleStatus(n: number) {
  return {
    ok: n > 0 ? false : true,
    checkedAt: new Date().toISOString(),
    supply_consistent: true,
    angel_supply_observed: 0,
    angel_supply_expected: null,
    cross_ledger: {
      fractionalized_batches: 0,
      fractional_mint_by_symbol: {},
      fractional_held_by_symbol: {},
      fractional_pool_reserve_by_symbol: {},
      fractional_consistent: true,
      pools_with_lp_tokens: 0,
      lp_tokens_pool_side: 0,
      lp_invariant_ok: true,
    },
    settlements: {
      pending_review_stale: n,
      settled_total_credited: 0,
      settled_total_rows: 0,
      burst_settlement_rails: [],
      burst_settlement_count: 0,
    },
    issues: n > 0 ? [`${n} stuck settlements`] : [],
  };
}

const statusWith = (overrides: { supply?: boolean; fractional?: boolean; lp?: boolean; stale?: number } = {}) => {
  const s = pendingStaleStatus(overrides.stale ?? 0);
  s.supply_consistent = overrides.supply ?? true;
  s.cross_ledger.fractional_consistent = overrides.fractional ?? true;
  s.cross_ledger.lp_invariant_ok = overrides.lp ?? true;
  s.ok = !(s.supply_consistent && s.cross_ledger.fractional_consistent && s.cross_ledger.lp_invariant_ok && s.settlements.pending_review_stale === 0);
  if (s.ok) s.issues = [];
  return s;
};

describe("Verifiable Breach Response & Execution Safety Interlock (Phase 24)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    process.env.SIGNING_PRIVATE_KEY = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
  });

  describe("classifyBreach (exact matrix)", () => {
    it("no breach -> no halt, no quarantine", () => {
      const c = classifyBreach(statusWith());
      expect(c.haltLive).toBe(false);
      expect(c.quarantineKinds).toEqual([]);
    });

    it("supply inconsistent -> haltLive only", () => {
      const c = classifyBreach(statusWith({ supply: false }));
      expect(c.haltLive).toBe(true);
      expect(c.quarantineKinds).toEqual([]);
    });

    it("fractional inconsistent -> haltLive + quarantine FRACTIONAL/LP", () => {
      const c = classifyBreach(statusWith({ fractional: false }));
      expect(c.haltLive).toBe(true);
      expect(c.quarantineKinds).toContain("FRACTIONAL");
      expect(c.quarantineKinds).toContain("LP");
    });

    it("pending review stale -> quarantine PAYMENT (no halt)", () => {
      const c = classifyBreach(statusWith({ stale: 3 }));
      expect(c.haltLive).toBe(false);
      expect(c.quarantineKinds).toEqual(["PAYMENT"]);
    });
  });

  describe("respondToBreach", () => {
    it("sets the durable halt + emits a signed, chained response (idempotent per attestation)", async () => {
      prismaMock.breachResponse.findUnique.mockResolvedValue(null);
      prismaMock.executionSafetyFlag.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.railSpec.findMany.mockResolvedValue([]); // no rails to quarantine (supply breach -> none)
      prismaMock.integrityAttestation.findUnique.mockResolvedValue({ attestationHash: "hash-prev" });
      prismaMock.breachResponse.create.mockResolvedValue({ id: "br1" });

      const status = statusWith({ supply: false });
      const resp = await respondToBreach(status, "attest_breach_1");

      expect(resp.halted).toBe(true);
      expect(resp.causedByAttestationId).toBe("attest_breach_1");
      expect(resp.signature).toBeTruthy();
      expect(prismaMock.executionSafetyFlag.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "global", liveExecutionHalted: false }),
          data: expect.objectContaining({ liveExecutionHalted: true }),
        })
      );
      // Chained + persisted.
      expect(prismaMock.breachResponse.create).toHaveBeenCalled();
      expect(resp.prevAttestationHash).toBe("hash-prev");
    });

    it("returns the ORIGINAL row on a redelivered attestationId (idempotent)", async () => {
      prismaMock.breachResponse.findUnique.mockResolvedValue({
        id: "br_existing",
        responseId: "attest_breach_1",
        causedByAttestationId: "attest_breach_1",
        halted: true,
        quarantinedRails: [],
        at: new Date(),
        attestationHash: "h1",
        prevAttestationHash: null,
        signature: "sig",
        publicKey: "pk",
        algorithm: "ed25519",
      });
      const resp = await respondToBreach(statusWith({ supply: false }), "attest_breach_1");
      expect(resp.halted).toBe(true);
      expect(prismaMock.executionSafetyFlag.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.breachResponse.create).not.toHaveBeenCalled();
    });

    it("quarantines ENABLED rails of matching kinds atomically", async () => {
      prismaMock.breachResponse.findUnique.mockResolvedValue(null);
      prismaMock.executionSafetyFlag.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.railSpec.findMany.mockResolvedValue([
        { id: "s_frac", railKey: "rail-frac", ledgerKind: "FRACTIONAL", version: 1, state: "ENABLED" },
        { id: "s_pay", railKey: "rail-pay", ledgerKind: "PAYMENT", version: 2, state: "ENABLED" },
      ]);
      prismaMock.railSpec.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.integrityAttestation.findUnique.mockResolvedValue({ attestationHash: "p" });
      prismaMock.breachResponse.create.mockResolvedValue({ id: "br2" });
      prismaMock.adminAuditLog.create.mockResolvedValue({});

      // fractional breach -> quarantine FRACTIONAL + LP, and PAYMENT stale also queued.
      const resp = await respondToBreach(statusWith({ fractional: false, stale: 2 }), "attest_b2");
      expect(resp.halted).toBe(true);
      expect(resp.quarantinedRails).toContain("rail-frac");
      expect(prismaMock.railSpec.findMany).toHaveBeenCalled(); // envelope: both kinds
    });
  });

  describe("verifyBreachResponse", () => {
    it("verifies a genuine signed response and rejects tampering", async () => {
      const pk = bytesToHex(getPublicKey(SEED));
      const body = { responseId: "r1", causedByAttestationId: "a1", halted: true, quarantinedRails: [], at: "2026-01-01T00:00:00Z" };
      const { verifyBreachResponse: v } = await import("../breach-response");
      // Can't easily call signBreachResponse (internal), so build + sign manually via a public path:
      // We instead verify a response produced by respondToBreach is valid (end-to-end).
      prismaMock.breachResponse.findUnique.mockResolvedValue(null);
      prismaMock.executionSafetyFlag.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.railSpec.findMany.mockResolvedValue([]);
      prismaMock.integrityAttestation.findUnique.mockResolvedValue({ attestationHash: "p" });
      prismaMock.breachResponse.create.mockResolvedValue({ id: "br3" });
      const resp = await respondToBreach(statusWith({ supply: false }), "attest_v1");
      const check = await v(resp);
      expect(check.valid).toBe(true);

      // Tamper: change halted.
      expect((await v({ ...resp, halted: false })).valid).toBe(false);
      expect(pk).toBeTruthy();
    });
  });

  describe("getExecutionSafetyFlag / clearHaltIfHealthy", () => {
    it("returns not-halted when absent", async () => {
      prismaMock.executionSafetyFlag.findUnique.mockResolvedValue(null);
      const flag = await getExecutionSafetyFlag();
      expect(flag.halted).toBe(false);
    });

    it("clears only when the LATEST attestation is ok:true AND newer than halt", async () => {
      prismaMock.executionSafetyFlag.findUnique.mockResolvedValue({
        id: "global", liveExecutionHalted: true, haltedAt: new Date(Date.now() - 10_000), version: 3,
      });
      prismaMock.integrityAttestation.findFirst.mockResolvedValue({ ok: true, checkedAt: new Date() });
      prismaMock.executionSafetyFlag.updateMany.mockResolvedValue({ count: 1 });
      expect(await clearHaltIfHealthy()).toBe(true);
    });

    it("refuses clear when the latest attestation is not healthy", async () => {
      prismaMock.executionSafetyFlag.findUnique.mockResolvedValue({
        id: "global", liveExecutionHalted: true, haltedAt: new Date(Date.now() - 10_000), version: 3,
      });
      prismaMock.integrityAttestation.findFirst.mockResolvedValue({ ok: false, checkedAt: new Date() });
      expect(await clearHaltIfHealthy()).toBe(false);
    });
  });

  describe("rotateSignerKey", () => {
    it("rotates to a new era and backfills the legacy column", async () => {
      prismaMock.railSignerKey.findFirst.mockResolvedValue({ id: "k1", publicKey: "old".padEnd(64, "0"), validUntil: null });
      prismaMock.railSignerKey.update.mockResolvedValue({ id: "k1", validUntil: new Date() });
      prismaMock.railSignerKey.create.mockResolvedValue({ id: "k2", publicKey: "new".repeat(2).padEnd(64, "f") });
      prismaMock.railSpec.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.adminAuditLog.create.mockResolvedValue({});

      const newKey = "a".repeat(64);
      const res = await rotateSignerKey("rail-1", newKey, "op_1");
      expect(res.railKey).toBe("rail-1");
      expect(prismaMock.railSignerKey.update).toHaveBeenCalled(); // ended old key
      expect(prismaMock.railSpec.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ signerCommitment: newKey }) })
      );
    });

    it("is idempotent when the new key is already current", async () => {
      prismaMock.railSignerKey.findFirst.mockResolvedValue({ id: "k1", publicKey: "b".repeat(64), validUntil: null });
      const { rotateSignerKey: r } = await import("../breach-response");
      const res = await r("rail-1", "b".repeat(64), "op");
      expect(prismaMock.railSignerKey.update).not.toHaveBeenCalled();
      expect(res.validUntil).toBeNull();
    });
  });

  describe("resolveLegacyOrEraKey", () => {
    it("prefers era-based key and falls back to the legacy column", async () => {
      prismaMock.railSignerKey.findFirst.mockResolvedValue({ publicKey: "era".padEnd(64, "0") });
      expect(await resolveLegacyOrEraKey("rail-1")).toBe("era".padEnd(64, "0"));

      prismaMock.railSignerKey.findFirst.mockResolvedValue(null);
      prismaMock.railSpec.findUnique.mockResolvedValue({ signerCommitment: "legacy".padEnd(64, "0") });
      expect(await resolveLegacyOrEraKey("rail-1")).toBe("legacy".padEnd(64, "0"));
    });
  });
});