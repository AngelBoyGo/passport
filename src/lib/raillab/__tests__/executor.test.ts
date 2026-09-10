import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    railSpec: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    railTelemetry: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    railCandidate: { findMany: vi.fn() },
    railSettlement: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
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

vi.mock("../factory-brain", () => ({
  scoreCandidate: vi.fn(),
  generalizeRunbook: vi.fn(),
  writeProposalRationale: vi.fn(),
}));

import {
  executeRailSettlement,
  canExecuteLive,
  resolveIdempotencyKey,
  runExecutionTick,
} from "../executor";
import { isSlaBreach, RAIL_P95_MS } from "../telemetry";
import { autoQuarantineFailingRails } from "../factory-agent";

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
  authorizedBy: null,
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

describe("Rail Execution Runtime (Phase 20)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("live-vs-dry-run gate", () => {
    it("requires a real canary endpoint (authorizedBy alone is not enough)", () => {
      expect(canExecuteLive({ endpoints: null })).toBe(false);
      expect(canExecuteLive({ endpoints: { sandboxUrl: "https://x" } })).toBe(true);
    });

    it("resolves the idempotency key from the configured path", () => {
      expect(resolveIdempotencyKey("external_reference", { external_reference: "TX-1" })).toBe("TX-1");
      expect(resolveIdempotencyKey("external_reference", { other: "x" })).toBeNull();
      expect(resolveIdempotencyKey(null, { external_reference: "TX-1" })).toBeNull();
    });

    it("rejects executing a non-ENABLED rail", async () => {
      prismaMock.railSpec.findUnique.mockResolvedValue(enabledSpec({ state: "PROPOSED" }));
      await expect(
        executeRailSettlement("rail-1", { payload: {} })
      ).rejects.toThrow(/not ENABLED/);
    });
  });

  describe("ledgerKind routing (a)", () => {
    it("ANGEL routes to settleMobileMoneyOnramp, dry-run by default (never mints)", async () => {
      prismaMock.railSpec.findUnique.mockResolvedValue(enabledSpec());
      prismaMock.fiatFix.findFirst.mockResolvedValue(validFix);
      prismaMock.moneySettlement.findUnique.mockResolvedValue(null);

      const result = await executeRailSettlement("rail-1", {
        payload: { external_reference: "TX-1", amount: 3000 },
      });

      expect(result.ok).toBe(true);
      expect(result.stage).toBe("ANGEL");
      expect(result.live).toBe(false);
      expect(result.errorTranche).toBe("NONE");
      // Dry-run must never create a settlement row or credit a wallet.
      expect(prismaMock.moneySettlement.create).not.toHaveBeenCalled();
      expect(prismaMock.agentWallet.upsert).not.toHaveBeenCalled();
      expect(prismaMock.operatorLedgerEntry.create).not.toHaveBeenCalled();
    });

    it("forceDryRun blocks live minting even when a sandboxUrl endpoint is set (execute-route guard)", async () => {
      // A rail with a live endpoint would otherwise be eligible; the /execute route MUST
      // force dry-run so an API-key holder can never mint ANGEL without the settlement
      // signature flow.
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

      expect(result.ok).toBe(true);
      expect(result.live).toBe(false);
      // settleMobileMoneyOnramp was called with dryRun=true -> no settlement, no wallet, no ledger.
      expect(prismaMock.moneySettlement.create).not.toHaveBeenCalled();
      expect(prismaMock.agentWallet.upsert).not.toHaveBeenCalled();
      expect(prismaMock.operatorLedgerEntry.create).not.toHaveBeenCalled();
    });

    it("FRACTIONAL dry-run validates shape without swapping", async () => {
      prismaMock.railSpec.findUnique.mockResolvedValue(
        enabledSpec({ ledgerKind: "FRACTIONAL" })
      );
      const result = await executeRailSettlement("rail-1", { payload: {} });
      expect(result.stage).toBe("FRACTIONAL");
      expect(result.live).toBe(false);
      expect(prismaMock.commodityLiquidityPool.updateMany).not.toHaveBeenCalled(); // no swap
    });

    it("LP dry-run validates shape without removing liquidity", async () => {
      prismaMock.railSpec.findUnique.mockResolvedValue(enabledSpec({ ledgerKind: "LP" }));
      const result = await executeRailSettlement("rail-1", { payload: {} });
      expect(result.stage).toBe("LP");
      expect(result.live).toBe(false);
    });

    it("STATE never mints treasury credits from the executor", async () => {
      prismaMock.railSpec.findUnique.mockResolvedValue(
        enabledSpec({ ledgerKind: "STATE", authorizedBy: "op_1" })
      );
      const result = await executeRailSettlement("rail-1", {
        payload: { country_code: "ML", amount: 500 },
      });
      expect(result.stage).toBe("STATE");
      expect(result.live).toBe(false);
      // Treasury credits are issued by reserve services, never this executor.
      expect(prismaMock.agentWallet.upsert).not.toHaveBeenCalled();
    });

    it("returns a logic error for an unknown ledgerKind", async () => {
      prismaMock.railSpec.findUnique.mockResolvedValue(enabledSpec({ ledgerKind: "NOPE" }));
      const result = await executeRailSettlement("rail-1", { payload: {} });
      expect(result.ok).toBe(false);
      expect(result.errorTranche).toBe("LOGIC_DETECTION");
    });
  });

  describe("telemetry SLA contract (b)", () => {
    it("flags breaches on error tranche, latency, and dedupe ratio", () => {
      expect(isSlaBreach({ latencyMs: 10, dedupeHits: 0, errorTranche: "SLA_BREACH", settlementCount: 100 })).toBe(true);
      expect(isSlaBreach({ latencyMs: RAIL_P95_MS + 1, dedupeHits: 0, errorTranche: "NONE", settlementCount: 100 })).toBe(true);
      expect(isSlaBreach({ latencyMs: 10, dedupeHits: 15, errorTranche: "NONE", settlementCount: 100 })).toBe(true);
      expect(isSlaBreach({ latencyMs: 10, dedupeHits: 0, errorTranche: "NONE", settlementCount: 100 })).toBe(false);
    });

    it("records a settlement with a monotonic seq", async () => {
      prismaMock.railTelemetry.findFirst.mockResolvedValue({ seq: 4 });
      prismaMock.railTelemetry.create.mockResolvedValue({ seq: 5 });
      const { recordSettlement } = await import("../telemetry");
      const seq = await recordSettlement("rail-1", {
        latencyMs: 10,
        volumeUnits: 5,
        dedupeHits: 0,
        errorTranche: "NONE",
        settlementCount: 1,
      });
      expect(seq).toBe(5);
      expect(prismaMock.railTelemetry.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ seq: 5, railKey: "rail-1" }) })
      );
    });
  });

  describe("auto-quarantine after 3 breaches (e)", () => {
    it("quarantines a rail whose last 3 telemetry rows breach", async () => {
      prismaMock.railSpec.findMany.mockResolvedValue([enabledSpec()]);
      prismaMock.railSpec.findUnique.mockResolvedValue(enabledSpec());
      prismaMock.railSettlement.findMany.mockResolvedValue([]); // no velocity burst
      prismaMock.railTelemetry.findMany.mockResolvedValue([
        { latencyMs: 99999, dedupeHits: 0, errorTranche: "NONE", settlementCount: 10 },
        { latencyMs: 99999, dedupeHits: 0, errorTranche: "NONE", settlementCount: 10 },
        { latencyMs: 99999, dedupeHits: 0, errorTranche: "NONE", settlementCount: 10 },
      ]);
      prismaMock.railSpec.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.adminAuditLog.create.mockResolvedValue({});

      const { quarantined } = await autoQuarantineFailingRails();
      expect(quarantined).toEqual(["rail-1"]);
    });

    it("quarantines immediately on a settlement-velocity burst (possible compromised signer)", async () => {
      prismaMock.railSpec.findMany.mockResolvedValue([enabledSpec()]);
      prismaMock.railSpec.findUnique.mockResolvedValue(enabledSpec());
      // 40 SETTLED within the window (threshold 25) -> burst.
      prismaMock.railSettlement.findMany.mockResolvedValue(
        Array.from({ length: 40 }, () => ({ railKey: "rail-1" }))
      );
      prismaMock.railTelemetry.findMany.mockResolvedValue([]); // even without telemetry breach
      prismaMock.railSpec.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.adminAuditLog.create.mockResolvedValue({});

      const { quarantined } = await autoQuarantineFailingRails();
      expect(quarantined).toEqual(["rail-1"]);
      // Quarantined via burst reason.
      expect(prismaMock.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ details: expect.stringContaining("velocity burst") }) })
      );
    });
  });

  describe("execution tick (runExecutionTick)", () => {
    it("executes dry-runs for each enabled rail and records telemetry", async () => {
      prismaMock.railSpec.findMany.mockResolvedValue([enabledSpec()]);
      prismaMock.railSpec.findUnique.mockResolvedValue(enabledSpec());
      prismaMock.fiatFix.findFirst.mockResolvedValue(validFix);
      prismaMock.moneySettlement.findUnique.mockResolvedValue(null);
      prismaMock.railTelemetry.findFirst.mockResolvedValue({ seq: 0 });
      prismaMock.railTelemetry.create.mockResolvedValue({ seq: 1 });
      prismaMock.railTelemetry.findMany.mockResolvedValue([]); // health check: no breaches

      const result = await runExecutionTick();

      expect(result.dryRun).toBe(1);
      expect(result.executed).toBe(0);
      expect(result.failed).toBe(0);
      expect(prismaMock.railTelemetry.create).toHaveBeenCalled();
    });
  });
});