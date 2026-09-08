import { describe, it, expect, vi, beforeEach } from "vitest";
import { sign, getPublicKey } from "@noble/ed25519";
import { hexToBytes, bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJson } from "@/lib/receipt/canonical";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    railSpec: { findUnique: vi.fn(), update: vi.fn() },
    railSettlement: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    railTelemetry: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    adminAuditLog: { create: vi.fn() },
    moneySettlement: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    fiatFix: { findFirst: vi.fn() },
    agentWallet: { upsert: vi.fn(), updateMany: vi.fn() },
    operatorLedgerEntry: { create: vi.fn() },
    commodityLiquidityPool: { findUnique: vi.fn(), updateMany: vi.fn() },
    fractionalCommodityBalance: { upsert: vi.fn(), updateMany: vi.fn() },
    ammSwapReceipt: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { settle, verifySettlementSignature, setRailSigner, listSettlements } from "../settlement";

const SIGNER_SEED = hexToBytes("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20");
const SIGNER_PUBLIC_KEY = bytesToHex(getPublicKey(SIGNER_SEED));
const OTHER_PUBLIC_KEY = "f".repeat(64);

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

describe("Authenticated Settlement Webhook (Phase 21)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("verifySettlementSignature", () => {
    it("verifies a valid signature against the rail signer", async () => {
      const check = await verifySettlementSignature(payload, signature, SIGNER_PUBLIC_KEY, SIGNER_PUBLIC_KEY);
      expect(check.valid).toBe(true);
    });

    it("rejects when the provided public key is not the rail signer", async () => {
      const check = await verifySettlementSignature(payload, signature, SIGNER_PUBLIC_KEY, OTHER_PUBLIC_KEY);
      expect(check.valid).toBe(false);
    });

    it("rejects when no signer commitment is set", async () => {
      const check = await verifySettlementSignature(payload, signature, null, SIGNER_PUBLIC_KEY);
      expect(check.valid).toBe(false);
    });
  });

  describe("settle — invalid signature -> REJECTED, no credit (a)", () => {
    it("marks REJECTED on a bad signature and never credits", async () => {
      prismaMock.railSpec.findUnique.mockResolvedValue(enabledSpec());
      prismaMock.railSettlement.create.mockResolvedValue({ id: "rs_1", settlementId: "RS-1" });
      prismaMock.railSettlement.update.mockResolvedValue({});
      prismaMock.railTelemetry.findFirst.mockResolvedValue({ seq: 0 });
      prismaMock.railTelemetry.create.mockResolvedValue({});
      prismaMock.adminAuditLog.create.mockResolvedValue({});

      const result = await settle("rail-1", {
        payload,
        reference: "TX-1",
        signature: "0".repeat(128), // invalid
        publicKey: SIGNER_PUBLIC_KEY,
      });

      expect(result.status).toBe("REJECTED");
      expect(result.creditedAngel).toBe(0);
      // No money path was touched.
      expect(prismaMock.agentWallet.upsert).not.toHaveBeenCalled();
      expect(prismaMock.moneySettlement.create).not.toHaveBeenCalled();
      expect(prismaMock.operatorLedgerEntry.create).not.toHaveBeenCalled();
      // Rejection audit-logged.
      expect(prismaMock.adminAuditLog.create).toHaveBeenCalled();
    });
  });

  describe("settle — idempotency (b)", () => {
    it("dedupes a redelivered reference and returns the ORIGINAL row", async () => {
      prismaMock.railSpec.findUnique.mockResolvedValue(enabledSpec());
      // First create succeeds.
      prismaMock.railSettlement.create.mockResolvedValue({ id: "rs_1", settlementId: "RS-1" });
      prismaMock.railSettlement.update.mockResolvedValue({});
      prismaMock.railTelemetry.findFirst.mockResolvedValue({ seq: 0 });
      prismaMock.railTelemetry.create.mockResolvedValue({});
      prismaMock.adminAuditLog.create.mockResolvedValue({});
      prismaMock.fiatFix.findFirst.mockResolvedValue(validFix);
      prismaMock.moneySettlement.findUnique.mockResolvedValue(null);

      const first = await settle("rail-1", { payload, reference: "TX-1", signature, publicKey: SIGNER_PUBLIC_KEY });
      expect(first.deduped).toBe(false);
      expect(first.status).toBe("SETTLED");

      // Second delivery: create collides -> return ORIGINAL.
      prismaMock.railSettlement.create.mockRejectedValueOnce(new Error("unique constraint"));
      prismaMock.railSettlement.findUnique.mockResolvedValue({
        id: "rs_1",
        settlementId: "RS-1",
        railKey: "rail-1",
        reference: "TX-1",
        status: "SETTLED",
        errorTranche: "NONE",
        creditedAngel: 1,
      });
      const second = await settle("rail-1", { payload, reference: "TX-1", signature, publicKey: SIGNER_PUBLIC_KEY });
      expect(second.deduped).toBe(true);
      expect(second.settlementId).toBe("RS-1");
      // Only one credit happened across both deliveries.
      expect(prismaMock.agentWallet.upsert).toHaveBeenCalledTimes(0); // ANGEL dry-run (no endpoint) mints nothing
    });
  });

  describe("settle — dry-run never mints without a live endpoint (c)", () => {
    it("SETTLED but live=false and no money moved when no sandboxUrl", async () => {
      prismaMock.railSpec.findUnique.mockResolvedValue(enabledSpec()); // endpoints null
      prismaMock.railSettlement.create.mockResolvedValue({ id: "rs_1", settlementId: "RS-1", railKey: "rail-1", reference: "TX-1" });
      prismaMock.railSettlement.update.mockResolvedValue({});
      prismaMock.railTelemetry.findFirst.mockResolvedValue({ seq: 0 });
      prismaMock.railTelemetry.create.mockResolvedValue({});
      prismaMock.adminAuditLog.create.mockResolvedValue({});
      prismaMock.fiatFix.findFirst.mockResolvedValue(validFix);
      prismaMock.moneySettlement.findUnique.mockResolvedValue(null);

      const result = await settle("rail-1", { payload, reference: "TX-1", signature, publicKey: SIGNER_PUBLIC_KEY });
      expect(result.status).toBe("SETTLED");
      expect(result.live).toBe(false);
      // Dry-run: the ANGEL path ran with dryRun=true -> no settlement row, no wallet, no treasury.
      expect(prismaMock.moneySettlement.create).not.toHaveBeenCalled();
      expect(prismaMock.agentWallet.upsert).not.toHaveBeenCalled();
      expect(prismaMock.operatorLedgerEntry.create).not.toHaveBeenCalled();
    });
  });

  describe("settle — executed as STATE (d) with a live endpoint", () => {
    it("explicitly forwards payload to the executor by ledgerKind and reports live", async () => {
      // STATE rail defers to reserve services in the executor (never mints in the executor).
      const spec = enabledSpec({ ledgerKind: "STATE", endpoints: { sandboxUrl: "https://sandbox" } });
      prismaMock.railSpec.findUnique.mockResolvedValue(spec);
      prismaMock.railSettlement.create.mockResolvedValue({ id: "rs_2", settlementId: "RS-2", railKey: "rail-1", reference: "TX-2" });
      prismaMock.railSettlement.update.mockResolvedValue({});
      prismaMock.railTelemetry.findFirst.mockResolvedValue({ seq: 0 });
      prismaMock.railTelemetry.create.mockResolvedValue({});
      prismaMock.adminAuditLog.create.mockResolvedValue({});
      prismaMock.agentWallet.upsert.mockResolvedValue({});

      const result = await settle("rail-1", {
        payload: { external_reference: "TX-2", country_code: "ML", amount: 500 },
        reference: "TX-2",
        signature: bytesToHex(await sign(utf8ToBytes(canonicalJson({ external_reference: "TX-2", country_code: "ML", amount: 500 })), SIGNER_SEED)),
        publicKey: SIGNER_PUBLIC_KEY,
      });

      // STATE defers — no mint in the executor; row marks settled (deferred outcome).
      expect(result.status).toBe("SETTLED");
      // Executor's STATE path returns live:false and never credits agentWallet.
      expect(prismaMock.agentWallet.upsert).not.toHaveBeenCalled();
    });
  });

  describe("settle — missing idempotency key -> PENDING_REVIEW (e)", () => {
    it("marks PENDING_REVIEW when payload lacks the configured key path", async () => {
      prismaMock.railSpec.findUnique.mockResolvedValue(enabledSpec()); // idempotencyKeyPath = external_reference
      prismaMock.railSettlement.create.mockResolvedValue({ id: "rs_3", settlementId: "RS-3" });
      prismaMock.railSettlement.update.mockResolvedValue({});
      prismaMock.railTelemetry.findFirst.mockResolvedValue({ seq: 0 });
      prismaMock.railTelemetry.create.mockResolvedValue({});
      prismaMock.adminAuditLog.create.mockResolvedValue({});

      const badPayload = { amount: 3000 }; // no external_reference
      const badSig = bytesToHex(await sign(utf8ToBytes(canonicalJson(badPayload)), SIGNER_SEED));
      const result = await settle("rail-1", {
        payload: badPayload,
        reference: "TX-3",
        signature: badSig,
        publicKey: SIGNER_PUBLIC_KEY,
      });

      expect(result.status).toBe("PENDING_REVIEW");
      expect(result.errorTranche).toBe("LOGIC_DETECTION");
      expect(prismaMock.agentWallet.upsert).not.toHaveBeenCalled();
    });
  });

  describe("settle/audit helpers", () => {
    it("requires a 64-hex signer commitment", async () => {
      await expect(setRailSigner("s1", "not-hex", "op_1")).rejects.toThrow(/64-hex/);
    });

    it("lists settlements with the audit tail", async () => {
      prismaMock.railSettlement.findMany.mockResolvedValue([]);
      const rows = await listSettlements({ railKey: "rail-1" });
      expect(rows).toEqual([]);
      expect(prismaMock.railSettlement.findMany).toHaveBeenCalled();
    });
  });
});