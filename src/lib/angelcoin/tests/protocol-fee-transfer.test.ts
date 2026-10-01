/* eslint-disable @typescript-eslint/no-explicit-any -- test harness uses partial Prisma mocks */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Audit fix M8: the protocol fee must be a TRANSFER out of the hirer's escrow
 * (SPEND sender -> TASK_PAYMENT treasury), never a minted ADJUSTMENT. Also the
 * hard gate must require the locked balance to cover payout + fee.
 */

const { entries, tx, makeAccount } = vi.hoisted(() => {
  const entries: any[] = [];
  let counter = 0;
  const byCommitment: Record<string, any> = {};
  const makeAccount = (c: string) => {
    if (!byCommitment[c]) {
      byCommitment[c] = { id: `acct_${++counter}`, subjectCommitment: c, creditState: "ACTIVE" };
    }
    return byCommitment[c];
  };
  const tx = {
    angelCoinAccount: {
      upsert: vi.fn(async (a: any) => makeAccount(a.where.subjectCommitment)),
      findUnique: vi.fn(async (a: any) => makeAccount(a.where.subjectCommitment)),
    },
    angelCoinJournalEntry: {
      create: vi.fn(async (a: any) => {
        const e = { id: `e${entries.length + 1}`, ...a.data, createdAt: new Date() };
        entries.push(e);
        return e;
      }),
      findMany: vi.fn(async (a: any) =>
        entries.filter((e) => e.accountId === a.where.accountId)
      ),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ id: "acct_1", subjectCommitment: "h" }]),
  };
  return { entries, tx, makeAccount };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: any) => fn(tx)),
    angelCoinAccount: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(async (a: any) => makeAccount(a.where.subjectCommitment)),
      create: vi.fn(async (a: any) => makeAccount(a.data.subjectCommitment)),
    },
    angelCoinJournalEntry: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
  },
}));
vi.mock("@/lib/enrollment/enrollment-service", () => ({
  isEnrollmentEnforcedForCredits: () => false,
  requireEnrolled: vi.fn(),
}));

import { releaseEscrowToWorker } from "@/lib/angelcoin/ledger-service";

const HIRER = "a".repeat(64);
const WORKER = "b".repeat(64);

// Seed a funded then locked escrow balance for the hirer account (acct_1).
function seedLocked(amount: number) {
  entries.push({ id: "seed0", accountId: "acct_1", entryType: "OPERATOR_GRANT", amount, createdAt: new Date(0) });
  entries.push({ id: "seed1", accountId: "acct_1", entryType: "LOCK", amount, createdAt: new Date(1) });
}

describe("releaseEscrowToWorker fee routing (audit fix M8)", () => {
  beforeEach(() => {
    entries.length = 0;
    vi.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([{ id: "acct_1", subjectCommitment: HIRER }]);
  });

  it("routes the fee to the treasury as SPEND + TASK_PAYMENT, never ADJUSTMENT", async () => {
    seedLocked(510); // 500 payout + 10 fee
    await releaseEscrowToWorker(HIRER, WORKER, 500, JSON.stringify({ task_id: "t1" }), 10);

    const kinds = tx.angelCoinJournalEntry.create.mock.calls.map((c: any) => c[0].data.entryType);
    expect(kinds).toContain("UNLOCK");
    expect(kinds).toContain("SPEND");
    expect(kinds).toContain("TASK_PAYMENT");
    // The bug was a minted ADJUSTMENT — it must never appear.
    expect(kinds).not.toContain("ADJUSTMENT");
    // fee SPEND (10) + worker SPEND (500) => two SPENDs.
    expect(kinds.filter((k: string) => k === "SPEND").length).toBe(2);
  });

  it("fails closed when locked escrow does not cover payout + fee", async () => {
    seedLocked(505); // covers 500 but NOT 500+10
    await expect(
      releaseEscrowToWorker(HIRER, WORKER, 500, undefined, 10)
    ).rejects.toThrow();
  });

  it("rejects a negative fee", async () => {
    seedLocked(1000);
    await expect(
      releaseEscrowToWorker(HIRER, WORKER, 500, undefined, -5)
    ).rejects.toThrow();
  });
});
