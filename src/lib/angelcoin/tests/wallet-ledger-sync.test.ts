/* eslint-disable @typescript-eslint/no-explicit-any -- test harness uses partial Prisma mocks */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Money-integrity invariants for the two-ledger unification:
 *  - every journal mutation mirrors AgentWallet.balance in the same tx;
 *  - a debit the wallet cannot cover FAILS CLOSED (wallet_ledger_desync);
 *  - minting primitives (safetyNetTopup/recoveryAward) pass the solvency gate.
 */

const h = vi.hoisted(() => {
  const state = {
    walletOps: [] as Array<{ op: string; args: any }>,
    journal: [] as any[],
    accounts: {} as Record<string, any>,
    debitCount: 1,
  };
  const tx: any = {
    $queryRaw: async () => [{ id: "acct", subjectCommitment: "x" }],
    angelCoinAccount: {
      upsert: async (a: any) => {
        const c = a.where.subjectCommitment;
        state.accounts[c] = state.accounts[c] ?? { id: `acct_${c.slice(0, 4)}`, subjectCommitment: c };
        return state.accounts[c];
      },
      findUnique: async (a: any) => state.accounts[a.where.subjectCommitment] ?? null,
    },
    angelCoinJournalEntry: {
      create: async (a: any) => {
        const e = { id: `e${state.journal.length}`, ...a.data, createdAt: new Date() };
        state.journal.push(e);
        return e;
      },
      findMany: async (a: any) => state.journal.filter((e) => e.accountId === a.where.accountId),
    },
    agentWallet: {
      upsert: async (a: any) => {
        state.walletOps.push({ op: "upsert", args: a });
        return {};
      },
      updateMany: async (a: any) => {
        state.walletOps.push({ op: "updateMany", args: a });
        return { count: state.debitCount };
      },
    },
  };
  return { state, tx };
});

vi.mock("@/lib/db", () => ({
  prisma: { ...h.tx, $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(h.tx) },
}));
vi.mock("@/lib/enrollment/enrollment-service", () => ({
  isEnrollmentEnforcedForCredits: () => false,
  requireEnrolled: async () => {},
}));
vi.mock("@/lib/monetary/reserve", () => ({ loadFiatReserveUsd: async () => 0 }));
vi.mock("@/lib/monetary/supply", () => ({
  circulatingSupply: async () => ({ supply: 0, staked: 0, circulating: 0, walletCount: 0 }),
}));
vi.mock("@/lib/monetary/parity", () => ({
  parityStatus: ({ supplyAngel, reserveUsd }: { supplyAngel: number; reserveUsd: number }) => {
    const required = supplyAngel * 5;
    return { reserveAdequate: reserveUsd >= required, requiredReserveUsd: required, coverageRatio: required ? reserveUsd / required : 1 };
  },
}));

import {
  transferCredits,
  lockCredits,
  unlockCredits,
  safetyNetTopup,
  recoveryAward,
} from "@/lib/angelcoin/ledger-service";

const FROM = "a".repeat(64);
const TO = "b".repeat(64);
const FROM_ACCT = `acct_${FROM.slice(0, 4)}`;

function seedGrant(amount: number) {
  h.state.journal.push({
    id: `seed_${h.state.journal.length}`,
    accountId: FROM_ACCT,
    entryType: "OPERATOR_GRANT",
    amount,
    createdAt: new Date(0),
  });
}

beforeEach(() => {
  h.state.walletOps = [];
  h.state.journal = [];
  h.state.accounts = {};
  h.state.debitCount = 1;
  process.env.ALLOW_UNBACKED_ISSUANCE = "1";
});

afterEach(() => {
  delete process.env.ALLOW_UNBACKED_ISSUANCE;
});

describe("wallet ⇄ journal mirroring", () => {
  it("transfer debits the sender wallet and credits the receiver wallet", async () => {
    seedGrant(100);
    await transferCredits(FROM, TO, 40);

    const debit = h.state.walletOps.find((o) => o.op === "updateMany");
    expect(debit?.args.where.subjectCommitment).toBe(FROM);
    expect(debit?.args.data.balance).toEqual({ decrement: 40 });

    const credit = h.state.walletOps.find(
      (o) => o.op === "upsert" && o.args.where.subjectCommitment === TO
    );
    expect(credit?.args.update.balance).toEqual({ increment: 40 });
  });

  it("fails CLOSED (wallet_ledger_desync) when the sender wallet cannot cover the debit", async () => {
    seedGrant(100);
    h.state.debitCount = 0; // wallet has no matching balance
    await expect(transferCredits(FROM, TO, 40)).rejects.toThrow(/wallet_ledger_desync/);
  });

  it("lock debits the wallet; unlock credits it back", async () => {
    seedGrant(100);
    await lockCredits(FROM, 25);
    const lockDebit = h.state.walletOps.find((o) => o.op === "updateMany");
    expect(lockDebit?.args.data.balance).toEqual({ decrement: 25 });

    h.state.walletOps = [];
    await unlockCredits(FROM, 25);
    const unlockCredit = h.state.walletOps.find((o) => o.op === "upsert");
    expect(unlockCredit?.args.update.balance).toEqual({ increment: 25 });
  });
});

describe("minting primitives are solvency-gated", () => {
  it("safetyNetTopup is refused when the mint would be undercollateralized", async () => {
    delete process.env.ALLOW_UNBACKED_ISSUANCE; // reserve = 0 → unbacked
    await expect(safetyNetTopup(FROM, 5)).rejects.toThrow(/issuance_refused_undercollateralized/);
  });

  it("recoveryAward is refused when the mint would be undercollateralized", async () => {
    delete process.env.ALLOW_UNBACKED_ISSUANCE;
    await expect(recoveryAward(FROM, 15)).rejects.toThrow(/issuance_refused_undercollateralized/);
  });

  it("safetyNetTopup mirrors the credit when allowed", async () => {
    await safetyNetTopup(FROM, 5);
    const credit = h.state.walletOps.find((o) => o.op === "upsert");
    expect(credit?.args.update.balance).toEqual({ increment: 5 });
  });
});
