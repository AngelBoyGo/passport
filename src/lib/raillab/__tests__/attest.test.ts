import { describe, it, expect, vi, beforeEach } from "vitest";
import { sign, getPublicKey } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    integrityAttestation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    adminAuditLog: { create: vi.fn() },
    agentWallet: { findMany: vi.fn() },
    railSpec: { findMany: vi.fn() },
    railSettlement: { findMany: vi.fn() },
    vaultBatch: { findMany: vi.fn() },
    fractionalCommodityBalance: { findMany: vi.fn() },
    commodityLiquidityPool: { findMany: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  runIntegrityAttestation,
  verifyIntegrityAttestation,
  hashIntegrityAttestation,
  getIntegrityPublicKeyHex,
  ATTESTATION_QUIET_PERIOD_MS,
} from "../attest";

describe("Continuous Integrity Attestation (Phase 23)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    process.env.SIGNING_PRIVATE_KEY = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
  });

  describe("hashIntegrityAttestation", () => {
    it("produces a deterministic 64-hex hash over the body", () => {
      const body = {
        attestationId: "a1", checkedAt: "2026-01-01T00:00:00Z", ok: true,
        supplyConsistent: true, fractionalConsistent: true, lpInvariantOk: true,
        pendingReviewStale: 0, settledTotalCredited: 0, settledTotalRows: 0, issues: [],
      };
      expect(hashIntegrityAttestation(body)).toMatch(/^[0-9a-f]{64}$/);
      expect(hashIntegrityAttestation(body)).toBe(hashIntegrityAttestation(body));
    });
  });

  describe("runIntegrityAttestation", () => {
    it("signs + persists a green attestation and chains prev hash", async () => {
      prismaMock.agentWallet.findMany.mockResolvedValue([{ balance: 100, staked: 0 }]);
      prismaMock.railSpec.findMany.mockResolvedValue([]);
      prismaMock.railSettlement.findMany.mockResolvedValue([]);
      prismaMock.vaultBatch.findMany.mockResolvedValue([]);
      prismaMock.fractionalCommodityBalance.findMany.mockResolvedValue([]);
      prismaMock.commodityLiquidityPool.findMany.mockResolvedValue([]);
      prismaMock.integrityAttestation.findFirst
        .mockResolvedValueOnce({ attestationHash: "prev-hash" }) // chain
        .mockResolvedValueOnce(null); // no prior breach
      prismaMock.integrityAttestation.create.mockResolvedValue({
        attestationId: "attest_1", attestationHash: "h1", signature: "sig", algorithm: "ed25519",
      });
      prismaMock.integrityAttestation.count.mockResolvedValue(0);
      prismaMock.adminAuditLog.create.mockResolvedValue({});

      const att = await runIntegrityAttestation();

      expect(att.ok).toBe(true);
      expect(att.prevAttestationHash).toBe("prev-hash");
      expect(att.signature).toBeTruthy();
      expect(att.publicKey).toBe(getIntegrityPublicKeyHex());
      // Persisted
      expect(prismaMock.integrityAttestation.create).toHaveBeenCalled();
      // No breach alert on green
      expect(prismaMock.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it("breaching check produces ok=false, chained hash, and an audit alert outside quiet period", async () => {
      prismaMock.agentWallet.findMany.mockResolvedValue([{ balance: 10, staked: 0 }]);
      prismaMock.railSpec.findMany.mockResolvedValue([]);
      prismaMock.railSettlement.findMany.mockResolvedValue([]);
      prismaMock.vaultBatch.findMany.mockResolvedValue([
        { fineWeightGrams: 1000, reserve: { symbol: "Au", commodityType: "GOLD" } }, // 1,000,000 mAu minted
      ]);
      prismaMock.fractionalCommodityBalance.findMany.mockResolvedValue([
        { commoditySymbol: "Au", milliUnits: 200_000 },
      ]);
      prismaMock.commodityLiquidityPool.findMany.mockResolvedValue([
        { commoditySymbol: "Au", commodityReserve: 100_000, totalLpTokens: 0 }, // 300k < 1M -> leak
      ]);
      // No prior attestation (chain null), no prior breach -> alert fires.
      prismaMock.integrityAttestation.findFirst.mockResolvedValue(null);
      prismaMock.integrityAttestation.create.mockResolvedValue({
        attestationId: "attest_2", attestationHash: "h2", signature: "sig", algorithm: "ed25519",
      });
      prismaMock.integrityAttestation.count.mockResolvedValue(0);
      prismaMock.adminAuditLog.create.mockResolvedValue({});

      const att = await runIntegrityAttestation();
      expect(att.ok).toBe(false);
      expect(att.supplyConsistent).toBe(true); // no expected supply passed -> consistent by default
      expect(att.fractionalConsistent).toBe(false);
      // Breach alert fired (no prior breach, outside quiet period).
      expect(prismaMock.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: "integrity_breach" }) })
      );
      expect(att.attestationHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("suppresses repeat breach alerts within the quiet period", async () => {
      prismaMock.agentWallet.findMany.mockResolvedValue([{ balance: 10, staked: 0 }]);
      prismaMock.railSpec.findMany.mockResolvedValue([]);
      prismaMock.railSettlement.findMany.mockResolvedValue([]);
      prismaMock.vaultBatch.findMany.mockResolvedValue([
        { fineWeightGrams: 1000, reserve: { symbol: "Au", commodityType: "GOLD" } },
      ]);
      prismaMock.fractionalCommodityBalance.findMany.mockResolvedValue([
        { commoditySymbol: "Au", milliUnits: 200_000 },
      ]);
      prismaMock.commodityLiquidityPool.findMany.mockResolvedValue([
        { commoditySymbol: "Au", commodityReserve: 100_000, totalLpTokens: 0 }, // leak -> breach
      ]);
      // A PRIOR breach row exists checked < QUIET_PERIOD ago -> this new breach is suppressed.
      prismaMock.integrityAttestation.findFirst
        .mockResolvedValueOnce(null) // chain
        .mockResolvedValueOnce({ checkedAt: new Date(Date.now() - 1000) }); // PRIOR breach (recent)
      prismaMock.integrityAttestation.create.mockResolvedValue({
        attestationId: "attest_3", attestationHash: "h3", signature: "sig",
      });
      prismaMock.integrityAttestation.count.mockResolvedValue(0);
      prismaMock.adminAuditLog.create.mockResolvedValue({});

      const att = await runIntegrityAttestation();
      // Breach exists but alert suppressed because a PRIOR breach row is within quiet period.
      expect(prismaMock.adminAuditLog.create).not.toHaveBeenCalled();
      expect(att.attestationHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("fires an alert when the PRIOR breach is older than the quiet period (not self-suppressed)", async () => {
      prismaMock.agentWallet.findMany.mockResolvedValue([{ balance: 10, staked: 0 }]);
      prismaMock.railSpec.findMany.mockResolvedValue([]);
      prismaMock.railSettlement.findMany.mockResolvedValue([]);
      prismaMock.vaultBatch.findMany.mockResolvedValue([
        { fineWeightGrams: 1000, reserve: { symbol: "Au", commodityType: "GOLD" } },
      ]);
      prismaMock.fractionalCommodityBalance.findMany.mockResolvedValue([
        { commoditySymbol: "Au", milliUnits: 200_000 },
      ]);
      prismaMock.commodityLiquidityPool.findMany.mockResolvedValue([
        { commoditySymbol: "Au", commodityReserve: 100_000, totalLpTokens: 0 }, // leak -> breach
      ]);
      // A PRIOR breach exists but is OLDER than the quiet period -> this breach MUST alert.
      // (Regression: the old code read the freshly-inserted breach as "prior" and would
      // make priorBreach == now, always suppressing the very first alert.)
      prismaMock.integrityAttestation.findFirst
        .mockResolvedValueOnce(null) // chain
        .mockResolvedValueOnce({ checkedAt: new Date(Date.now() - 2 * ATTESTATION_QUIET_PERIOD_MS) });
      prismaMock.integrityAttestation.create.mockResolvedValue({
        attestationId: "attest_recovery", attestationHash: "hr", signature: "sig",
      });
      prismaMock.integrityAttestation.count.mockResolvedValue(0);
      prismaMock.adminAuditLog.create.mockResolvedValue({});

      const att = await runIntegrityAttestation();
      expect(att.ok).toBe(false);
      expect(prismaMock.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: "integrity_breach" }) })
      );
    });

    it("does not throw when the DB is unreachable; returns a signed BREACH attestation", async () => {
      // force runIntegrityCheck's own DB read to throw
      prismaMock.agentWallet.findMany.mockRejectedValueOnce(new Error("db down"));
      prismaMock.integrityAttestation.create.mockResolvedValue({
        attestationId: "attest_4", attestationHash: "h4", signature: "sig",
      });
      prismaMock.integrityAttestation.findFirst.mockResolvedValue(null);
      prismaMock.integrityAttestation.count.mockResolvedValue(0);
      prismaMock.adminAuditLog.create.mockResolvedValue({});

      const att = await runIntegrityAttestation();
      expect(att.ok).toBe(false);
      expect(att.issues.join(" ")).toContain("read failed");
    });

    it("prunes attestations beyond the retention cap", async () => {
      prismaMock.agentWallet.findMany.mockResolvedValue([{ balance: 100, staked: 0 }]);
      prismaMock.railSpec.findMany.mockResolvedValue([]);
      prismaMock.railSettlement.findMany.mockResolvedValue([]);
      prismaMock.vaultBatch.findMany.mockResolvedValue([]);
      prismaMock.fractionalCommodityBalance.findMany.mockResolvedValue([]);
      prismaMock.commodityLiquidityPool.findMany.mockResolvedValue([]);
      prismaMock.integrityAttestation.findFirst.mockResolvedValue(null);
      prismaMock.integrityAttestation.create.mockResolvedValue({
        attestationId: "attest_5", attestationHash: "h5", signature: "sig",
      });
      prismaMock.integrityAttestation.count.mockResolvedValue(20000);
      prismaMock.integrityAttestation.findMany.mockResolvedValue([
        { checkedAt: new Date(Date.now() - 999999) },
      ]);
      prismaMock.integrityAttestation.deleteMany.mockResolvedValue({ count: 10000 });

      await runIntegrityAttestation();
      expect(prismaMock.integrityAttestation.deleteMany).toHaveBeenCalled();
    });
  });

  describe("verifyIntegrityAttestation", () => {
    it("verifies a genuine signed attestation", async () => {
      const pk = hexToBytes("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20");
      const pub = bytesToHex(getPublicKey(pk));
      const body = {
        attestationId: "v1", checkedAt: "2026-01-01T00:00:00Z", ok: true,
        supplyConsistent: true, fractionalConsistent: true, lpInvariantOk: true,
        pendingReviewStale: 0, settledTotalCredited: 0, settledTotalRows: 0, issues: [],
      };
      const hash = hashIntegrityAttestation(body);
      const sig = bytesToHex(await sign(utf8ToBytes(hash), pk));
      const result = await verifyIntegrityAttestation({
        ...body,
        prevAttestationHash: null,
        attestationHash: hash,
        signature: sig,
        publicKey: pub,
        algorithm: "ed25519" as const,
      });
      expect(result.valid).toBe(true);
    });

    it("rejects a tampered body", async () => {
      const pk = hexToBytes("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20");
      const pub = bytesToHex(getPublicKey(pk));
      const body = {
        attestationId: "v1", checkedAt: "2026-01-01T00:00:00Z", ok: true,
        supplyConsistent: true, fractionalConsistent: true, lpInvariantOk: true,
        pendingReviewStale: 0, settledTotalCredited: 0, settledTotalRows: 0, issues: [],
      };
      const hash = hashIntegrityAttestation(body);
      const sig = bytesToHex(await sign(utf8ToBytes(hash), pk));
      // Tamper: change ok to false AFTER hashing/signing -> hash mismatch.
      const result = await verifyIntegrityAttestation({
        ...body,
        ok: false, // tampered
        prevAttestationHash: null,
        attestationHash: hash,
        signature: sig,
        publicKey: pub,
        algorithm: "ed25519" as const,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("hash mismatch");
    });

    it("rejects a bad signature", async () => {
      const pk = hexToBytes("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20");
      const pub = bytesToHex(getPublicKey(pk));
      const body = {
        attestationId: "v1", checkedAt: "2026-01-01T00:00:00Z", ok: true,
        supplyConsistent: true, fractionalConsistent: true, lpInvariantOk: true,
        pendingReviewStale: 0, settledTotalCredited: 0, settledTotalRows: 0, issues: [],
      };
      const hash = hashIntegrityAttestation(body);
      const result = await verifyIntegrityAttestation({
        ...body,
        prevAttestationHash: null,
        attestationHash: hash,
        signature: "0".repeat(128), // wrong signature
        publicKey: pub,
        algorithm: "ed25519" as const,
      });
      expect(result.valid).toBe(false);
    });
  });
});