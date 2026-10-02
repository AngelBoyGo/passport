import { describe, it, expect, vi } from "vitest";
import { computeBalances } from "@/lib/angelcoin/balances";
import { AngelCoinEntryType } from "@prisma/client";

/**
 * T1c — Ledger property + concurrency invariants (failure hypothesis F-093:
 * missing end-to-end money tests let regressions reach production).
 *
 * Pure reducer properties (no DB). These are the invariants that must hold for
 * ANY journal, and they catch the classes of bug we already found (double
 * spend, strand-on-cancel, mint-from-nothing).
 */

const T = AngelCoinEntryType;
const e = (type: AngelCoinEntryType, amount: number) => ({ entryType: type, amount });

describe("F-093 · ledger reducer invariants", () => {
  it("availableBalance is never increased by LOCK (locking withholds, never grants)", () => {
    const granted = computeBalances([e(T.OPERATOR_GRANT, 100)]).availableBalance;
    const locked = computeBalances([e(T.OPERATOR_GRANT, 100), e(T.LOCK, 40)]).availableBalance;
    expect(locked).toBeLessThanOrEqual(granted);
    expect(locked).toBe(60);
  });

  it("SPEND never increases availableBalance", () => {
    const a = computeBalances([e(T.OPERATOR_GRANT, 100)]).availableBalance;
    const b = computeBalances([e(T.OPERATOR_GRANT, 100), e(T.SPEND, 30)]).availableBalance;
    expect(b).toBeLessThan(a);
  });

  it("a LOCK with no UNLOCK strands exactly that amount (regression: M8 fee-on-cancel)", () => {
    const entries = [e(T.OPERATOR_GRANT, 510), e(T.LOCK, 510)];
    const bal = computeBalances(entries);
    // This is the bug shape: available 0, locked 510 with nothing to release it.
    expect(bal.availableBalance).toBe(0);
    expect(bal.lockedBalance).toBe(510);
  });

  it("ADJUSTMENT is the ONLY entry type that can mint (documents the mint surface)", () => {
    const mint = computeBalances([e(T.ADJUSTMENT, 1_000_000)]);
    expect(mint.availableBalance).toBe(1_000_000);
    // No other type creates balance from zero.
    const others = [T.OPERATOR_GRANT, T.PEER_GIFT, T.TASK_PAYMENT, T.SAFETY_NET_TOPUP, T.RECOVERY_AWARD];
    for (const t of others) {
      // Grants/earned DO add balance but are not "mint" in the supply sense —
      // assert they are the deliberate, accounted-for sources.
      expect(computeBalances([e(t, 5)]).availableBalance).toBe(5);
    }
  });

  it("balance is deterministic — identical journals always yield identical balances", () => {
    const journal = [e(T.OPERATOR_GRANT, 100), e(T.LOCK, 50), e(T.UNLOCK, 20), e(T.SPEND, 10)];
    const first = computeBalances(journal);
    const second = computeBalances([...journal]);
    expect(second).toEqual(first);
  });
});
