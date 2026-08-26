import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    bridgeWallet: { findFirst: vi.fn() },
    externalSettlement: { findFirst: vi.fn() },
  },
}));

// We'll gate the withdraw service on a real pubkey check only when a signature
// is provided; otherwise ownership is via bridgeWallet binding. burnAndPayout is
// mocked below so this test stays unit-testable without the full prisma surface.
const burnAndPayoutMock = vi.hoisted(() => vi.fn());
const walletForCommitmentMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/bridge/ledger", () => ({ burnAndPayout: burnAndPayoutMock }));
vi.mock("@/lib/bridge/wallet", () => ({
  walletForCommitment: walletForCommitmentMock,
  ensureOperatorWallet: vi.fn(),
  ensureAgentWallet: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { requestWithdrawal } from "@/lib/bridge/withdraw";
import { WithdrawalOwnershipError } from "@/lib/bridge/withdraw";

describe("Withdraw / burn / payout — test bank E", () => {
  const worker = "b".repeat(64);
  const operatorId = "op_1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("E1: rejects a withdrawal with no owned wallet binding (ownership gate)", async () => {
    walletForCommitmentMock.mockResolvedValue(null);

    await expect(
      requestWithdrawal({ subjectCommitment: worker, operatorId, amount: 1000, reference: "wd_1" })
    ).rejects.toThrow(WithdrawalOwnershipError);
    expect(burnAndPayoutMock).not.toHaveBeenCalled();
  });

  it("E1b: burns and records payout intent when the wallet belongs to the caller", async () => {
    walletForCommitmentMock.mockResolvedValue({ operatorId, subjectCommitment: worker });
    burnAndPayoutMock.mockResolvedValue({ applied: true });

    const result = await requestWithdrawal({
      subjectCommitment: worker,
      operatorId,
      amount: 500,
      reference: "wd_2",
    });

    expect(burnAndPayoutMock).toHaveBeenCalledWith(
      expect.objectContaining({ reference: "wd_2", amount: 500 })
    );
    // proof-of-payout receipt id returned
    if (!result.applied) throw new Error("expected withdrawal applied");
    expect(result.receipt_id).toBeDefined();
  });

  it("E1c: a zero/negative amount is rejected", async () => {
    await expect(
      requestWithdrawal({ subjectCommitment: worker, operatorId, amount: 0, reference: "wd_0" })
    ).rejects.toThrow(/amount/i);
  });

  it("E2/D3: an already-burned reference returns a duplicate (exactly-once via burnAndPayout)", async () => {
    walletForCommitmentMock.mockResolvedValue({ operatorId, subjectCommitment: worker });
    burnAndPayoutMock.mockResolvedValue({ applied: false, reason: "Duplicate burn/payout" });

    const result = await requestWithdrawal({ subjectCommitment: worker, operatorId, amount: 100, reference: "wd_dup" });
    expect(result.applied).toBe(false);
    if (result.applied) throw new Error("expected withdrawal refused");
    expect(result.reason).toMatch(/duplicate/i);
  });
});