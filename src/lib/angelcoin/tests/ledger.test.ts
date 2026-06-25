import { describe, it, expect } from "vitest";
import { AngelCoinEntryType } from "@prisma/client";
import { computeBalances } from "@/lib/angelcoin/balances";

describe("computeBalances", () => {
  it("computes granted balance from OPERATOR_GRANT entries", () => {
    const balances = computeBalances([
      { entryType: AngelCoinEntryType.OPERATOR_GRANT, amount: 100 },
      { entryType: AngelCoinEntryType.OPERATOR_GRANT, amount: 50 },
    ]);
    expect(balances.grantedBalance).toBe(150);
    expect(balances.availableBalance).toBe(150);
  });

  it("computes earned balance from inflow entry types", () => {
    const balances = computeBalances([
      { entryType: AngelCoinEntryType.PEER_GIFT, amount: 20 },
      { entryType: AngelCoinEntryType.TASK_PAYMENT, amount: 30 },
      { entryType: AngelCoinEntryType.SAFETY_NET_TOPUP, amount: 10 },
      { entryType: AngelCoinEntryType.RECOVERY_AWARD, amount: 5 },
    ]);
    expect(balances.earnedBalance).toBe(65);
    expect(balances.availableBalance).toBe(65);
  });

  it("subtracts SPEND from available balance", () => {
    const balances = computeBalances([
      { entryType: AngelCoinEntryType.OPERATOR_GRANT, amount: 100 },
      { entryType: AngelCoinEntryType.SPEND, amount: 40 },
    ]);
    expect(balances.spentBalance).toBe(40);
    expect(balances.availableBalance).toBe(60);
  });

  it("tracks locked balance as LOCK minus UNLOCK floored at zero", () => {
    const balances = computeBalances([
      { entryType: AngelCoinEntryType.OPERATOR_GRANT, amount: 100 },
      { entryType: AngelCoinEntryType.LOCK, amount: 30 },
      { entryType: AngelCoinEntryType.UNLOCK, amount: 10 },
    ]);
    expect(balances.lockedBalance).toBe(20);
    expect(balances.availableBalance).toBe(80);
  });

  it("floors locked balance at zero when unlocks exceed locks", () => {
    const balances = computeBalances([
      { entryType: AngelCoinEntryType.LOCK, amount: 10 },
      { entryType: AngelCoinEntryType.UNLOCK, amount: 25 },
    ]);
    expect(balances.lockedBalance).toBe(0);
  });

  it("applies signed ADJUSTMENT to available balance", () => {
    const balances = computeBalances([
      { entryType: AngelCoinEntryType.OPERATOR_GRANT, amount: 100 },
      { entryType: AngelCoinEntryType.ADJUSTMENT, amount: -15 },
      { entryType: AngelCoinEntryType.ADJUSTMENT, amount: 5 },
    ]);
    expect(balances.availableBalance).toBe(90);
  });

  it("is deterministic across all entry types combined", () => {
    const entries = [
      { entryType: AngelCoinEntryType.OPERATOR_GRANT, amount: 200 },
      { entryType: AngelCoinEntryType.PEER_GIFT, amount: 25 },
      { entryType: AngelCoinEntryType.TASK_PAYMENT, amount: 25 },
      { entryType: AngelCoinEntryType.SPEND, amount: 50 },
      { entryType: AngelCoinEntryType.LOCK, amount: 30 },
      { entryType: AngelCoinEntryType.UNLOCK, amount: 10 },
      { entryType: AngelCoinEntryType.ADJUSTMENT, amount: -5 },
    ];
    const first = computeBalances(entries);
    const second = computeBalances(entries);
    expect(first).toEqual(second);
    expect(first).toEqual({
      grantedBalance: 200,
      earnedBalance: 50,
      spentBalance: 50,
      lockedBalance: 20,
      availableBalance: 175,
    });
  });
});
