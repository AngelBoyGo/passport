import { describe, it, expect, vi, beforeEach } from "vitest";
import { sign, getPublicKey } from "@noble/ed25519";
import { hexToBytes, bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJson } from "@/lib/receipt/canonical";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    railSpec: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    railSettlement: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    railTelemetry: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    railCandidate: { findMany: vi.fn() },
    adminAuditLog: { create: vi.fn() },
    moneySettlement: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    fiatFix: { findFirst: vi.fn() },
    agentWallet: { upsert: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    operatorLedgerEntry: { create: vi.fn() },
    commodityLiquidityPool: { findUnique: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    fractionalCommodityBalance: { upsert: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    vaultBatch: { findMany: vi.fn() },
    ammSwapReceipt: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

vi.mock("../factory-brain", () => ({
  scoreCandidate: vi.fn(),
  generalizeRunbook: vi.fn(),
  writeProposalRationale: vi.fn(),
}));

import { settle } from "../settlement";
import { executeRailSettlement, runExecutionTick } from "../executor";
import { runIntegrityCheck } from "../integrity";

const SIGNER_SEED = hexToBytes("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20");
const SIGNER_PUBLIC_KEY = bytesToHex(getPublicKey(SIGNER_SEED));

const enabledSpec = (overrides: Record<string, unknown> = {}) => ({
  id: "s1",
  railKey: "rail-1",
  name: "FX USD/XOF",
  category: "PAYMENT",
  providerKey: "agent_api",
  ledgerKind: "ANGEL",
  kycTier: "NONE",
  feeBps: 10,
  endpoints: null,
  idempotencyKeyPath: "external_reference",
  fxActor: null,
  state: "ENABLED",
  authorizedBy: "op_1",
  signerCommitment: SIGNER_PUBLIC_KEY,
  version: 1,
  ...overrides,
});

const validFix = {
  currency: "XOF",
  rateUsdPerUnit: 1 / 600.0,
  source: "test",
  validFrom: new Date(Date.now() - 60_000),
  expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
};

const payload = { external_reference: "TX-1", amount: 3000 };
const signature = bytesToHex(await sign(utf8ToBytes(canonicalJson(payload)), SIGNER_SEED));

describe("Money-Ledger Integrity & Adversarial Audit (Phase 22)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("(a) unauthenticated /execute must not mint even with a live endpoint", () => {
    it("forceDryRun blocks ANGEL minting on a sandboxUrl rail", async () => {
      prismaMock.railSpec.findUnique.mockResolvedValue(
        enabledSpec({ endpoints: { sandboxUrl: "https://sandbox.example" } })
      );
      prismaMock.fiatFix.findFirst.mockResolvedValue(validFix);
      prismaMock.moneySettlement.findUnique.mockResolvedValue(null);

      const result = await executeRailSettlement(
        "rail-1",
        { payload: { external_reference: "TX-1", amount: 3000 } },
        { forceDryRun: true }
      );

      expect(result.live).toBe(false);
      expect(result.ok).toBe(true);
      // No money touched.
      expect(prismaMock.moneySettlement.create).not.toHaveBeenCalled();
      expect(prismaMock.agentWallet.upsert).not.toHaveBeenCalled();
      expect(prismaMock.operatorLedgerEntry.create).not.toHaveBeenCalled();
    });
  });

  describe("(b) /tick must be dry-run only", () => {
    it("runExecutionTick never mints on an ENABLED rail", async () => {
      prismaMock.railSpec.findMany.mockResolvedValue([
        enabledSpec({ endpoints: { sandboxUrl: "https://sandbox.example" } }),
      ]);
      prismaMock.railSpec.findUnique.mockResolvedValue(
        enabledSpec({ endpoints: { sandboxUrl: "https://sandbox.example" } })
      );
      prismaMock.fiatFix.findFirst.mockResolvedValue(validFix);
      prismaMock.moneySettlement.findUnique.mockResolvedValue(null);
      prismaMock.railTelemetry.findFirst.mockResolvedValue({ seq: 0 });
      prismaMock.railTelemetry.create.mockResolvedValue({});
      prismaMock.railTelemetry.findMany.mockResolvedValue([]); // health: no breaches

      const result = await runExecutionTick();

      expect(result.dryRun).toBe(1);
      expect(result.executed).toBe(0);
      expect(prismaMock.moneySettlement.create).not.toHaveBeenCalled();
      expect(prismaMock.agentWallet.upsert).not.toHaveBeenCalled();
      expect(prismaMock.operatorLedgerEntry.create).not.toHaveBeenCalled();
    });
  });

  describe("(c) /settle double-delivery is idempotent (single credit)", () => {
    it("second delivery returns the ORIGINAL row and credits exactly once", async () => {
      prismaMock.railSpec.findUnique.mockResolvedValue(enabledSpec());
      prismaMock.railSettlement.create.mockResolvedValue({ id: "rs_1", settlementId: "RS-1" });
      prismaMock.railSettlement.update.mockResolvedValue({});
      prismaMock.railTelemetry.findFirst.mockResolvedValue({ seq: 0 });
      prismaMock.railTelemetry.create.mockResolvedValue({});
      prismaMock.adminAuditLog.create.mockResolvedValue({});
      prismaMock.fiatFix.findFirst.mockResolvedValue(validFix);
      prismaMock.moneySettlement.findUnique.mockResolvedValue(null);

      const first = await settle("rail-1", { payload, reference: "TX-1", signature, publicKey: SIGNER_PUBLIC_KEY });
      expect(first.deduped).toBe(false);

      // Second delivery: create collides -> return original.
      prismaMock.railSettlement.create.mockRejectedValueOnce(new Error("unique constraint"));
      prismaMock.railSettlement.findUnique.mockResolvedValue({
        id: "rs_1", settlementId: "RS-1", railKey: "rail-1", reference: "TX-1",
        status: "SETTLED", errorTranche: "NONE", creditedAngel: 1,
      });
      const second = await settle("rail-1", { payload, reference: "TX-1", signature, publicKey: SIGNER_PUBLIC_KEY });
      expect(second.deduped).toBe(true);
      expect(second.settlementId).toBe("RS-1");
      // Exactly once across both calls (dry-run ANGEL mints nothing here either).
      expect(prismaMock.agentWallet.upsert).toHaveBeenCalledTimes(0);
    });
  });

  describe("(d) forged signature -> REJECTED, no credit", () => {
    it("tampered payload with a valid key signature is rejected", async () => {
      prismaMock.railSpec.findUnique.mockResolvedValue(enabledSpec());
      prismaMock.railSettlement.create.mockResolvedValue({ id: "rs_1", settlementId: "RS-1" });
      prismaMock.railSettlement.update.mockResolvedValue({});
      prismaMock.railTelemetry.findFirst.mockResolvedValue({ seq: 0 });
      prismaMock.railTelemetry.create.mockResolvedValue({});
      prismaMock.adminAuditLog.create.mockResolvedValue({});

      const otherPayload = { external_reference: "TX-1", amount: 99999 };
      const badSig = bytesToHex(await sign(utf8ToBytes(canonicalJson(otherPayload)), SIGNER_SEED));
      // Signature is over canonicalJson(otherPayload); settling with `payload` (different) will mismatch.
      const result = await settle("rail-1", {
        payload,
        reference: "TX-1",
        signature: badSig,
        publicKey: SIGNER_PUBLIC_KEY,
      });

      expect(result.status).toBe("REJECTED");
      expect(prismaMock.agentWallet.upsert).not.toHaveBeenCalled();
      expect(prismaMock.moneySettlement.create).not.toHaveBeenCalled();
    });
  });

  describe("(e) reference mismatch with idempotencyKeyPath -> PENDING_REVIEW", () => {
    it("marks PENDING_REVIEW (LOGIC_DETECTION) and does not credit", async () => {
      prismaMock.railSpec.findUnique.mockResolvedValue(enabledSpec()); // idempotencyKeyPath = external_reference
      prismaMock.railSettlement.create.mockResolvedValue({ id: "rs_1", settlementId: "RS-1" });
      prismaMock.railSettlement.update.mockResolvedValue({});
      prismaMock.railTelemetry.findFirst.mockResolvedValue({ seq: 0 });
      prismaMock.railTelemetry.create.mockResolvedValue({});
      prismaMock.adminAuditLog.create.mockResolvedValue({});

      const referenceless = { amount: 3000 }; // no external_reference key
      const sig = bytesToHex(await sign(utf8ToBytes(canonicalJson(referenceless)), SIGNER_SEED));
      const result = await settle("rail-1", {
        payload: referenceless,
        reference: "TX-1",
        signature: sig,
        publicKey: SIGNER_PUBLIC_KEY,
      });

      expect(result.status).toBe("PENDING_REVIEW");
      expect(result.errorTranche).toBe("LOGIC_DETECTION");
      expect(prismaMock.agentWallet.upsert).not.toHaveBeenCalled();
    });
  });

  describe("(f) signature replay across railKeys is rejected", () => {
    it("a payload+signature valid on rail-1 is rejected on rail-2 (different signer)", async () => {
      const rail2Key = "rail-2";
      prismaMock.railSpec.findUnique.mockResolvedValue(
        enabledSpec({ id: "s2", railKey: rail2Key, signerCommitment: "f".repeat(64) })
      );
      prismaMock.railSettlement.create.mockResolvedValue({ id: "rs_2", settlementId: "RS-2" });
      prismaMock.railSettlement.update.mockResolvedValue({});
      prismaMock.railTelemetry.findFirst.mockResolvedValue({ seq: 0 });
      prismaMock.railTelemetry.create.mockResolvedValue({});
      prismaMock.adminAuditLog.create.mockResolvedValue({});

      const result = await settle(rail2Key, {
        payload,
        reference: "TX-1",
        signature,
        publicKey: SIGNER_PUBLIC_KEY,
      });

      // Signature is bound to the rail's signer commitment; rail-2's signer differs -> rejected.
      expect(result.status).toBe("REJECTED");
      expect(prismaMock.agentWallet.upsert).not.toHaveBeenCalled();
    });
  });

  describe("(g) sandboxUrl does not enable live mint outside /settle", () => {
    it("FRACTIONAL /execute stays dry-run with a sandboxUrl", async () => {
      prismaMock.railSpec.findUnique.mockResolvedValue(
        enabledSpec({ ledgerKind: "FRACTIONAL", endpoints: { sandboxUrl: "https://s" } })
      );
      const result = await executeRailSettlement("rail-1", { payload: {} }, { forceDryRun: true });
      expect(result.live).toBe(false);
      expect(prismaMock.commodityLiquidityPool.updateMany).not.toHaveBeenCalled(); // no swap
      expect(prismaMock.agentWallet.upsert).not.toHaveBeenCalled();
    });

    it("STATE /execute never mints treasury credits", async () => {
      prismaMock.railSpec.findUnique.mockResolvedValue(
        enabledSpec({ ledgerKind: "STATE", endpoints: { sandboxUrl: "https://s" } })
      );
      const result = await executeRailSettlement("rail-1", {
        payload: { country_code: "ML", amount: 500 },
      });
      expect(result.live).toBe(false);
      expect(prismaMock.agentWallet.upsert).not.toHaveBeenCalled();
    });
  });

  describe("(h) non-ANGEL ledgers never touch AgentWallet in dry-run", () => {
    it("LP executor path stays dry-run and leaves AgentWallet untouched", async () => {
      prismaMock.railSpec.findUnique.mockResolvedValue(enabledSpec({ ledgerKind: "LP" }));
      const result = await executeRailSettlement("rail-1", { payload: {} });
      expect(result.live).toBe(false);
      expect(prismaMock.agentWallet.upsert).not.toHaveBeenCalled();
      expect(prismaMock.fractionalCommodityBalance.upsert).not.toHaveBeenCalled();
    });
  });

  describe("integrity health check (ledger conservation)", () => {
    it("flags supply inconsistency when wallet supply differs from the canonical S", async () => {
      prismaMock.agentWallet.findMany.mockResolvedValue([
        { balance: 100, staked: 0 },
        { balance: 50, staked: 0 },
      ]);
      prismaMock.railSpec.findMany.mockResolvedValue([]);
      prismaMock.railSettlement.findMany.mockResolvedValue([]);
      prismaMock.vaultBatch.findMany.mockResolvedValue([]);
      prismaMock.fractionalCommodityBalance.findMany.mockResolvedValue([]);
      prismaMock.commodityLiquidityPool.findMany.mockResolvedValue([]);

      const status = await runIntegrityCheck({ expectedAngelSupply: 200 });

      // sum(wallet.balance) = 150 != 200
      expect(status.supply_consistent).toBe(false);
      expect(status.ok).toBe(false);
    });

    it("reports ok when supply + non-ANGEL ledgers are conserved", async () => {
      prismaMock.agentWallet.findMany.mockResolvedValue([
        { balance: 100, staked: 0 },
        { balance: 50, staked: 0 },
      ]);
      prismaMock.railSpec.findMany.mockResolvedValue([]);
      prismaMock.railSettlement.findMany.mockResolvedValue([]);
      prismaMock.vaultBatch.findMany.mockResolvedValue([]);
      prismaMock.fractionalCommodityBalance.findMany.mockResolvedValue([]);
      prismaMock.commodityLiquidityPool.findMany.mockResolvedValue([]);

      const status = await runIntegrityCheck({ expectedAngelSupply: 150 });
      expect(status.supply_consistent).toBe(true);
      expect(status.ok).toBe(true);
    });

    it("considers swaps by including pool commodityReserve (no false positive on buy-side held)", async () => {
      // One 1,000g Au batch fractionalized -> 1,000,000 mAu minted.
      // 200,000 mAu sits in holder wallets (some bought via swaps), 800,000 mAu sits in the
      // pool as commodityReserve after swaps/LP-seed. minted === held + pooled -> consistent.
      prismaMock.agentWallet.findMany.mockResolvedValue([{ balance: 0, staked: 0 }]);
      prismaMock.railSpec.findMany.mockResolvedValue([]);
      prismaMock.railSettlement.findMany.mockResolvedValue([]);
      prismaMock.vaultBatch.findMany.mockResolvedValue([
        { fineWeightGrams: 1000, reserve: { symbol: "Au", commodityType: "GOLD" } },
      ]);
      prismaMock.fractionalCommodityBalance.findMany.mockResolvedValue([
        { commoditySymbol: "Au", milliUnits: 200_000 },
      ]);
      prismaMock.commodityLiquidityPool.findMany.mockResolvedValue([
        { commoditySymbol: "Au", commodityReserve: 800_000, totalLpTokens: 0 },
      ]);

      const status = await runIntegrityCheck({ expectedAngelSupply: 0 });
      expect(status.cross_ledger.fractional_consistent).toBe(true);
      expect(status.ok).toBe(true);
    });

    it("flags a real fractional leak (minted != held + pooled)", async () => {
      prismaMock.agentWallet.findMany.mockResolvedValue([{ balance: 0, staked: 0 }]);
      prismaMock.railSpec.findMany.mockResolvedValue([]);
      prismaMock.railSettlement.findMany.mockResolvedValue([]);
      prismaMock.vaultBatch.findMany.mockResolvedValue([
        { fineWeightGrams: 1000, reserve: { symbol: "Au", commodityType: "GOLD" } }, // 1,000,000 mAu minted
      ]);
      prismaMock.fractionalCommodityBalance.findMany.mockResolvedValue([
        { commoditySymbol: "Au", milliUnits: 200_000 },
      ]);
      // Pool only holds 100,000 -> 300,000 total != 1,000,000 minted (700,000 leaked).
      prismaMock.commodityLiquidityPool.findMany.mockResolvedValue([
        { commoditySymbol: "Au", commodityReserve: 100_000, totalLpTokens: 0 },
      ]);

      const status = await runIntegrityCheck({ expectedAngelSupply: 0 });
      expect(status.cross_ledger.fractional_consistent).toBe(false);
      expect(status.ok).toBe(false);
    });

    it("flags settlement-velocity bursts (compromised-signer detection)", async () => {
      prismaMock.agentWallet.findMany.mockResolvedValue([{ balance: 0, staked: 0 }]);
      prismaMock.railSpec.findMany.mockResolvedValue([]);
      prismaMock.commodityLiquidityPool.findMany.mockResolvedValue([]);
      prismaMock.vaultBatch.findMany.mockResolvedValue([]);
      prismaMock.fractionalCommodityBalance.findMany.mockResolvedValue([]);
      // Call order in runIntegrityCheck: (1) stale PENDING/PENDING_REVIEW, (2) settled,
      // (3) velocity window. Stale -> [] ; settled -> 40 ; velocity -> 40 on "rail-1".
      prismaMock.railSettlement.findMany
        .mockResolvedValueOnce([]) // stale
        .mockResolvedValueOnce(Array.from({ length: 40 }, () => ({ creditedAngel: 1 }))) // settled
        .mockResolvedValueOnce(Array.from({ length: 40 }, () => ({ railKey: "rail-1" }))); // velocity
      const status = await runIntegrityCheck({ expectedAngelSupply: 0 });
      expect(status.ok).toBe(false);
      expect(status.settlements.burst_settlement_rails.length).toBe(1);
      expect(status.settlements.burst_settlement_count).toBe(40);
    });
  });
});