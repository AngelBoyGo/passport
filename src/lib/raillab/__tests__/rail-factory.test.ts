import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    railSpec: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    railCandidate: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    railTelemetry: { findMany: vi.fn(), create: vi.fn() },
    railRunbook: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    adminAuditLog: { create: vi.fn() },
    fiatFix: { findFirst: vi.fn(), create: vi.fn() },
    moneySettlement: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    agentWallet: { upsert: vi.fn() },
    operatorLedgerEntry: { create: vi.fn() },
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
  transitionRailState,
  canTransition,
} from "../state-machine";
import {
  computeStructuralSimilarity,
  generalizeAndAutomateRunbook,
  proposeSpecFromCandidate,
  provisionAdoptionCanary,
  enableRailSpec,
  quarantineRailSpec,
  autoQuarantineFailingRails,
  FACTORY_COMMITMENT,
  PROPOSAL_SCORE_THRESHOLD,
} from "../factory-agent";
import { generalizeRunbook as brainGeneralize, writeProposalRationale } from "../factory-brain";
import { mockSmokeTest, MockLedger, sandboxSmokeTest } from "../smoke-test";
import { runDiscovery, fingerprintCandidate } from "../discovery";
import { settleMobileMoneyOnramp } from "../../digital-gateway/mobile-money";

const validFix = {
  id: "fix_1",
  currency: "XOF",
  rateUsdPerUnit: 1 / 600.0,
  source: "test",
  validFrom: new Date(Date.now() - 60_000),
  expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
};

describe("Autonomous Rail Factory (Phase 19)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("state machine (a)", () => {
    it("rejects illegal transitions", () => {
      expect(canTransition("PROPOSED", "ENABLED")).toBe(false);
      expect(canTransition("ENABLED", "PROPOSED")).toBe(false);
      expect(canTransition("RETIRED", "ENABLED")).toBe(false);
      expect(canTransition("SMOKE_TESTED", "ENABLED")).toBe(true);
      expect(canTransition("ENABLED", "QUARANTINED")).toBe(true);
    });

    it("atomically transitions on version/state match", async () => {
      const tx = prismaMock;
      tx.railSpec.updateMany.mockResolvedValue({ count: 1 });
      await expect(
        transitionRailState(tx, { id: "s1", from: "SMOKE_TESTED", to: "ENABLED", version: 4 })
      ).resolves.toBeUndefined();
      expect(tx.railSpec.updateMany).toHaveBeenCalledWith({
        where: { id: "s1", state: "SMOKE_TESTED", version: 4 },
        data: { state: "ENABLED", version: { increment: 1 } },
      });
    });

    it("aborts on concurrent mutation (count 0) — concurrent-enable guard", async () => {
      const tx = prismaMock;
      tx.railSpec.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        transitionRailState(tx, { id: "s1", from: "SMOKE_TESTED", to: "ENABLED", version: 4 })
      ).rejects.toThrow(/moved under us/i);
    });

    it("enableRailSpec refuses empty authorizedBy", async () => {
      await expect(enableRailSpec("s1", "   ")).rejects.toThrow(/authorizedBy/i);
      expect(prismaMock.railSpec.updateMany).not.toHaveBeenCalled();
    });

    it("enableRailSpec transitions SMOKE_TESTED → ENABLED and audit-logs", async () => {
      prismaMock.railSpec.findUnique.mockResolvedValue({
        id: "s1",
        railKey: "rail-abc",
        version: 2,
        state: "SMOKE_TESTED",
      });
      prismaMock.railSpec.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.railSpec.update.mockResolvedValue({});
      prismaMock.adminAuditLog.create.mockResolvedValue({});

      await enableRailSpec("s1", "op_1");

      expect(prismaMock.railSpec.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "s1", state: "SMOKE_TESTED", version: 2 },
          data: { state: "ENABLED", version: { increment: 1 } },
        })
      );
      expect(prismaMock.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: "raillab_enable" }) })
      );
    });
  });

  describe("discovery dedupe by fingerprint (b)", () => {
    it("produces identical fingerprints for identical normalized candidates", () => {
      const a = {
        source: "frankfurter",
        name: "FX USD/XOF settlement",
        category: "PAYMENT",
        providerKey: "fx.frankfurter.usd.xof",
        ledgerKind: "STATE",
        kycTier: "NONE",
        feeBps: 10,
      };
      // `raw` is transport metadata only — it must not affect the dedupe fingerprint.
      const b = { ...a, raw: { ignored: true } };
      expect(fingerprintCandidate(a)).toBe(fingerprintCandidate(b));
      // But a real field difference (endpoints) must change the fingerprint.
      const c = { ...a, endpoints: { latest: "https://example.com" } };
      expect(fingerprintCandidate(a)).not.toBe(fingerprintCandidate(c));
    });

    it("skips a duplicate candidate and counts it", async () => {
      const source = {
        name: "fake",
        fetch: async () => [
          {
            source: "fake",
            name: "A",
            category: "PAYMENT",
            providerKey: "p",
            ledgerKind: "ANGEL",
            kycTier: "NONE",
            feeBps: 0,
          },
          {
            source: "fake",
            name: "A",
            category: "PAYMENT",
            providerKey: "p",
            ledgerKind: "ANGEL",
            kycTier: "NONE",
            feeBps: 0,
          },
        ],
      };
      prismaMock.railCandidate.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "existing" });
      prismaMock.railCandidate.create.mockResolvedValue({ id: "new" });
      prismaMock.railTelemetry.create.mockResolvedValue({});

      const result = await runDiscovery([source]);

      expect(result.created).toBe(1);
      expect(result.skippedDuplicates).toBe(1);
    });
  });

  describe("MOCK smoke-test leak guard (c)", () => {
    it("passes non-ANGEL rails without touching AgentWallet", () => {
      expect(mockSmokeTest({ ledgerKind: "FRACTIONAL", feeBps: 50 }).outcome).toBe("PASS");
      expect(mockSmokeTest({ ledgerKind: "LP", feeBps: 0 }).outcome).toBe("PASS");
      expect(mockSmokeTest({ ledgerKind: "STATE", feeBps: 10 }).outcome).toBe("PASS");
    });

    it("MockLedger isolates non-ANGEL units from the ANGEL money ledger", () => {
      const ledger = new MockLedger();
      ledger.credit("FRACTIONAL", "alice", 1000);
      ledger.credit("LP", "vault", 500);
      expect(ledger.agentWallet.size).toBe(0);
      // ANGEL kind does use the agent wallet
      ledger.credit("ANGEL", "bob", 100);
      expect(ledger.agentWallet.size).toBe(1);
    });
  });

  describe("SANDBOX double-callback dedupe (d)", () => {
    it("dedupes the second identical callback via the real settlement path", async () => {
      prismaMock.fiatFix.findFirst.mockResolvedValue(validFix);
      prismaMock.moneySettlement.create
        .mockResolvedValueOnce({ id: "set_1", status: "PENDING" })
        .mockRejectedValueOnce(new Error("Unique constraint failed on provider_externalRef"));
      prismaMock.moneySettlement.findUnique.mockResolvedValue({
        id: "set_1",
        provider: "agent_api",
        externalRef: "TX-1",
        xofAmount: 3000,
        xofRateUsd: 1 / 600.0,
        creditedAngel: 1,
        targetCommitment: "c".repeat(64),
        status: "SETTLED",
      });
      prismaMock.agentWallet.upsert.mockResolvedValue({});
      prismaMock.operatorLedgerEntry.create.mockResolvedValue({});
      prismaMock.moneySettlement.update.mockResolvedValue({});

      const payload = { external_reference: "TX-1", amount: 3000 };
      const first = await settleMobileMoneyOnramp({ provider: "agent_api", payload, internal: true });
      const second = await settleMobileMoneyOnramp({ provider: "agent_api", payload, internal: true });

      expect(first.deduped).toBe(false);
      expect(second.deduped).toBe(true);
      // Exactly one credit across both calls.
      expect(prismaMock.agentWallet.upsert).toHaveBeenCalledTimes(1);
    });

    it("smoke rung dry-run never mints money or touches the treasury", async () => {
      prismaMock.fiatFix.findFirst.mockResolvedValue(validFix);
      prismaMock.moneySettlement.findUnique.mockResolvedValue(null);

      const result = await sandboxSmokeTest();
      expect(result.outcome).toBe("PASS");
      // Dry-run must NOT create a settlement row, credit a wallet, or book the treasury.
      expect(prismaMock.moneySettlement.create).not.toHaveBeenCalled();
      expect(prismaMock.agentWallet.upsert).not.toHaveBeenCalled();
      expect(prismaMock.operatorLedgerEntry.create).not.toHaveBeenCalled();
    });
  });

  describe("auto-quarantine after 3 SLA breaches (e)", () => {
    it("quarantines a rail with 3 consecutive breaches", async () => {
      prismaMock.railSpec.findMany.mockResolvedValue([
        { id: "s1", railKey: "rail-bad", state: "ENABLED", version: 1 },
      ]);
      prismaMock.railSpec.findUnique.mockResolvedValue({
        id: "s1",
        railKey: "rail-bad",
        state: "ENABLED",
        version: 1,
      });
      prismaMock.railTelemetry.findMany.mockResolvedValue([
        { errorTranche: "SLA_BREACH" },
        { errorTranche: "COMPUTE_TIMEOUT" },
        { errorTranche: "SLA_BREACH" },
      ]);
      prismaMock.railSpec.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.adminAuditLog.create.mockResolvedValue({});

      const { quarantined } = await autoQuarantineFailingRails();
      expect(quarantined).toEqual(["rail-bad"]);
      expect(prismaMock.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: "raillab_quarantine" }) })
      );
    });

    it("does not quarantine a rail with fewer than 3 breaches", async () => {
      prismaMock.railSpec.findMany.mockResolvedValue([
        { id: "s1", railKey: "rail-ok", state: "ENABLED", version: 1 },
      ]);
      prismaMock.railTelemetry.findMany.mockResolvedValue([
        { errorTranche: "SLA_BREACH" },
        { errorTranche: "NONE" },
      ]);
      const { quarantined } = await autoQuarantineFailingRails();
      expect(quarantined).toEqual([]);
    });
  });

  describe("runbook generalization + auto-provision (f)", () => {
    it("flags structurally similar samples as ≥85% similar", () => {
      const specs = [
        { category: "PAYMENT", ledgerKind: "STATE", kycTier: "NONE", feeBps: 10 },
        { category: "PAYMENT", ledgerKind: "STATE", kycTier: "NONE", feeBps: 12 },
        { category: "PAYMENT", ledgerKind: "STATE", kycTier: "NONE", feeBps: 15 },
      ];
      expect(computeStructuralSimilarity(specs)).toBeGreaterThanOrEqual(0.85);
    });

    it("generalizes and automates a runbook with 3+ similar samples", async () => {
      prismaMock.railRunbook.findUnique.mockResolvedValue({
        id: "rb_1",
        blueprintId: "bp_1",
        sampleSpecs: [
          { category: "PAYMENT", ledgerKind: "STATE", kycTier: "NONE", feeBps: 10 },
          { category: "PAYMENT", ledgerKind: "STATE", kycTier: "NONE", feeBps: 12 },
          { category: "PAYMENT", ledgerKind: "STATE", kycTier: "NONE", feeBps: 15 },
        ],
        generalization: null,
        automated: false,
      });
      (brainGeneralize as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        template: { category: "PAYMENT", ledgerKind: "STATE" },
      });
      prismaMock.railRunbook.update.mockResolvedValue({});

      const result = await generalizeAndAutomateRunbook("bp_1");
      expect(result.automated).toBe(true);
      expect(prismaMock.railRunbook.update).toHaveBeenCalled();
    });

    it("auto-proposes a spec from a candidate crossing the threshold", async () => {
      prismaMock.railCandidate.findUnique.mockResolvedValue({
        id: "c1",
        fingerprint: "f".repeat(16),
        score: 0.8,
        needsReview: false,
        proposedBlueprintId: "bp_1",
        payload: {
          name: "FX USD/XOF",
          category: "PAYMENT",
          providerKey: "fx.usd.xof",
          ledgerKind: "STATE",
          kycTier: "NONE",
          feeBps: 10,
        },
      });
      (writeProposalRationale as unknown as ReturnType<typeof vi.fn>).mockResolvedValue("rationale");
      prismaMock.railSpec.create.mockResolvedValue({ id: "s1", railKey: "rail-f" });
      prismaMock.railCandidate.update.mockResolvedValue({});

      const spec = await proposeSpecFromCandidate("c1");
      expect(spec).not.toBeNull();
      expect(prismaMock.railSpec.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            authorCommitment: FACTORY_COMMITMENT,
            state: "PROPOSED",
            railKey: expect.stringMatching(/^rail-/),
          }),
        })
      );
    });

    it("declines a candidate below the score threshold", async () => {
      prismaMock.railCandidate.findUnique.mockResolvedValue({
        id: "c2",
        fingerprint: "g".repeat(16),
        score: 0.1,
        needsReview: false,
        payload: {},
      });
      const spec = await proposeSpecFromCandidate("c2");
      expect(spec).toBeNull();
      expect(prismaMock.railSpec.create).not.toHaveBeenCalled();
    });
  });

  describe("quarantine (g)", () => {
    it("quarantines an ENABLED rail and audit-logs the reason", async () => {
      prismaMock.railSpec.findUnique.mockResolvedValue({
        id: "s1",
        railKey: "rail-x",
        state: "ENABLED",
        version: 3,
      });
      prismaMock.railSpec.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.adminAuditLog.create.mockResolvedValue({});

      await quarantineRailSpec("s1", "manual test");

      expect(prismaMock.railSpec.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "s1", state: "ENABLED", version: 3 },
          data: { state: "QUARANTINED", version: { increment: 1 } },
        })
      );
    });
  });

  describe("adoption canary provisioning (Phase 26)", () => {
    const SIGNER = "a".repeat(64);

    it("creates PROPOSED → PROVISIONED → SMOKE_TESTED → ENABLED and sets the canary signer", async () => {
      const specShape = { id: "s1", railKey: "adopt-x", state: "PROPOSED", version: 1, providerKey: "agent_api", ledgerKind: "ANGEL" };
      // sequence: provisionAdoptionCanary initial existence check (null) → provisionSpec re-read
      // (the created spec) → enableRailSpec re-read (the spec)
      prismaMock.railSpec.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValue(specShape);
      prismaMock.railSpec.create.mockResolvedValue(specShape);
      prismaMock.railSpec.update.mockResolvedValue({});
      // state transitions: PROVISIONED + SMOKE_TESTED (called via transitionRailState → updateMany)
      prismaMock.railSpec.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.railSpec.findMany.mockResolvedValue([]); // smoke ladder read-backs
      prismaMock.adminAuditLog.create.mockResolvedValue({});

      const result = await provisionAdoptionCanary({
        railKey: "adopt-x",
        name: "Adoption Canary",
        category: "PAYMENT",
        providerKey: "agent_api",
        kycTier: "NONE",
        feeBps: 0,
        signerCommitment: SIGNER,
        authorizedBy: "op_1",
      });

      expect(result.state).toBe("ENABLED");
      // enableRailSpec audit + canary audit
      expect(prismaMock.adminAuditLog.create).toHaveBeenCalledTimes(2);
      // signer was persisted below-case
      expect(prismaMock.railSpec.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "s1" },
          data: { signerCommitment: SIGNER },
        })
      );
    });

    it("is idempotent: returns an already-ENABLED canary without re-provisioning", async () => {
      prismaMock.railSpec.findUnique.mockResolvedValue({
        id: "s1",
        railKey: "adopt-x",
        state: "ENABLED",
      });
      const result = await provisionAdoptionCanary({
        railKey: "adopt-x",
        name: "Adoption Canary",
        category: "PAYMENT",
        providerKey: "agent_api",
        kycTier: "NONE",
        feeBps: 0,
        signerCommitment: SIGNER,
        authorizedBy: "op_1",
      });
      expect(result.id).toBe("s1");
      expect(prismaMock.railSpec.create).not.toHaveBeenCalled();
    });

    it("refuses a non-ENABLED preexisting rail and a bad signer commitment", async () => {
      prismaMock.railSpec.findUnique.mockResolvedValue({
        id: "s1",
        railKey: "adopt-x",
        state: "QUARANTINED",
      });
      await expect(
        provisionAdoptionCanary({
          railKey: "adopt-x",
          name: "x",
          category: "PAYMENT",
          providerKey: "agent_api",
          kycTier: "NONE",
          feeBps: 0,
          signerCommitment: SIGNER,
          authorizedBy: "op_1",
        })
      ).rejects.toThrow(/already exists in state QUARANTINED/);

      prismaMock.railSpec.findUnique.mockResolvedValue(null);
      await expect(
        provisionAdoptionCanary({
          railKey: "adopt-x",
          name: "x",
          category: "PAYMENT",
          providerKey: "agent_api",
          kycTier: "NONE",
          feeBps: 0,
          signerCommitment: "not-hex",
          authorizedBy: "op_1",
        })
      ).rejects.toThrow(/signer_commitment must be a 64-hex/);
    });
  });
});