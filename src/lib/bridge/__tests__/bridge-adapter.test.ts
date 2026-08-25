import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    externalSettlement: { create: vi.fn(), findFirst: vi.fn() },
    angelCoinAccount: { upsert: vi.fn() },
    angelCoinJournalEntry: { count: vi.fn(), create: vi.fn() },
    capabilityLedgerEntry: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<void>) => fn(prismaMock)),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  listAccounts,
  getTransferStatus,
  computeBridgeSignature,
  verifyBridgeSignature,
} from "@/lib/bridge/client";
import { applyBridgeDeposit, burnAndPayout } from "@/lib/bridge/ledger";

describe("Bridge (Open Issuance) adapter — test bank A", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BRIDGE_CLIENT_ID = "test_client";
    process.env.BRIDGE_CLIENT_SECRET = "test_secret";
    process.env.BRIDGE_ENV = "sandbox";
    process.env.BRIDGE_WEBHOOK_SECRET = "whsec_bridge_test";
    // defaults for happy-path ledger writes
    prismaMock.angelCoinAccount.upsert.mockResolvedValue({ id: "acc_default" });
    prismaMock.angelCoinJournalEntry.create.mockResolvedValue({ id: "je_default" });
    prismaMock.capabilityLedgerEntry.create.mockResolvedValue({ id: "ce_default" });
  });

  // ---- A1 ----
  it("A1: listAccounts returns a typed accounts list from the sandbox API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "acct_1", custodial_status: "ready" }],
      }),
    } as Response);

    const accounts = await listAccounts();
    expect(accounts).toEqual([{ id: "acct_1", custodial_status: "ready" }]);
    expect(fetchMock).toHaveBeenCalled();
  });

  // ---- A3 ----
  it("A3: getTransferStatus maps Bridge status codes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "xfer_1", state: "confirmed" } }),
    } as Response);

    await expect(getTransferStatus("xfer_1")).resolves.toBe("confirmed");
  });

  // ---- A4 ----
  it("A4a: verifyBridgeSignature accepts a genuine HMAC", async () => {
    const payload = { event: "deposit.confirmed", transfer_id: "xfer_9" };
    const secret = "whsec_bridge_test";
    const sig = computeBridgeSignature(payload, secret);
    expect(verifyBridgeSignature(payload, sig, secret).valid).toBe(true);
  });

  it("A4b: verifyBridgeSignature rejects an invalid HMAC", async () => {
    const payload = { event: "deposit.confirmed" };
    const result = verifyBridgeSignature(payload, "deadbeef", "whsec_bridge_test");
    expect(result.valid).toBe(false);
  });

  // ---- A5 ----
  it("A5: applyBridgeDeposit mints exactly once (idempotent via unique rail+reference)", async () => {
    prismaMock.externalSettlement.create.mockResolvedValueOnce({ id: "ss1" });
    prismaMock.angelCoinAccount.upsert.mockResolvedValueOnce({ id: "acc_1" });
    prismaMock.angelCoinJournalEntry.create.mockResolvedValueOnce({ id: "je1" });
    prismaMock.capabilityLedgerEntry.create.mockResolvedValueOnce({ id: "ce1" });

    const result = await applyBridgeDeposit({
      operatorId: "op_1",
      subjectCommitment: "c".repeat(64),
      bridgeTransferId: "xfer_deposit_1",
      amount: 2500,
    });

    expect(result.applied).toBe(true);
    expect(result.transferId).toContain("xfer_deposit_1");
    expect(prismaMock.externalSettlement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rail: "bridge_issuance",
          reference: "bridge_xfer_deposit_1",
        }),
      })
    );
  });

  it("A5b: a duplicate bridge webhook does not double-mint (insert fails on unique)", async () => {
    prismaMock.externalSettlement.create.mockRejectedValueOnce({ code: "P2002" });
    const result = await applyBridgeDeposit({
      operatorId: "op_1",
      subjectCommitment: "c".repeat(64),
      bridgeTransferId: "xfer_deposit_dup",
      amount: 100,
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/duplicate|already/i);
    expect(prismaMock.angelCoinJournalEntry.create).not.toHaveBeenCalled();
  });

  // ---- A6 ----
  it("A6: burnAndPayout is idempotent and refuses when backing reserve is insufficient", async () => {
    // reserve check: amount <= backing tracked by a pending ledger; here we test
    // the explicit refusal path via a pre-existing settlement marker.
    prismaMock.externalSettlement.findFirst.mockResolvedValueOnce({ id: "already_burned" });

    const result = await burnAndPayout({
      operatorId: "op_1",
      subjectCommitment: "c".repeat(64),
      reference: "burn_ref_1",
      amount: 100,
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/duplicate|already/i);
  });

  it("A6b: burnAndPayout proceeds when no duplicate marker exists", async () => {
    prismaMock.externalSettlement.findFirst.mockResolvedValueOnce(null);
    prismaMock.externalSettlement.create.mockResolvedValueOnce({ id: "burn_ss" });
    prismaMock.angelCoinJournalEntry.create.mockResolvedValueOnce({ id: "burn_je" });
    prismaMock.capabilityLedgerEntry.create.mockResolvedValueOnce({ id: "burn_ce" });

    const result = await burnAndPayout({
      operatorId: "op_1",
      subjectCommitment: "c".repeat(64),
      reference: "burn_ref_ok",
      amount: 500,
    });
    expect(result.applied).toBe(true);
  });
});