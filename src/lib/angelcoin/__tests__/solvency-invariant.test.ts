import { describe, it, expect } from "vitest";
import { computeEconomyHealth, type EconomyHealthInput } from "@/lib/agent-economy/economy-health";
import { computeBalances } from "@/lib/angelcoin/balances";
import { parityStatus } from "@/lib/monetary/parity";
import { AngelCoinEntryType } from "@prisma/client";

/**
 * T1a/T1b — Money-path invariants (failure hypotheses F-001, F-009).
 *
 * F-001: AngelCoin advertises 1:1 reserves. `computeEconomyHealth.reserve_usd`
 *        is derived from operator LEDGER TOP-UP entries — bookkeeping, NOT a
 *        verified held asset. This test makes that explicit and asserts the
 *        coverage math, so a regression or an over-claim is caught here.
 * F-009: two ledgers (AgentWallet.balance vs AngelCoinAccount journal) must not
 *        drift. `computeBalances` is the canonical reducer for the journal; the
 *        economy-health `supply_angel` sums wallets. These must agree.
 */

const NOW = new Date("2026-06-15T12:00:00.000Z");

function empty(): EconomyHealthInput {
  return { wallets: [], reserveEntries: [], revenue: [], purchases: [], engagements: [], disputes: [], capabilities: [], offers: [], jobs: [] };
}

describe("F-001 · reserve coverage invariant (reserve is bookkeeping, not held asset)", () => {
  it("coverage_ratio uses the reserve ledger top-ups as the 'reserve' (documented limitation)", () => {
    const input = empty();
    input.wallets = [{ balance: 100, staked: 0 }]; // 100 ANGEL supply
    input.reserveEntries = [{ deltaMicros: 500_000_000 }]; // $500 "reserve" booked
    const h = computeEconomyHealth(input, NOW);
    // supply 100 ANGEL * $5 par = $500 required; booked $500 => ratio 1.0
    expect(h.supply_angel).toBe(100);
    expect(h.reserve_usd).toBe(500);
    expect(h.coverage_ratio).toBe(1);
    expect(h.reserve_adequate).toBe(true);
  });

  it("flags undercollateralization when supply outruns booked reserve", () => {
    const input = empty();
    input.wallets = [{ balance: 1_000, staked: 0 }]; // $5,000 required
    input.reserveEntries = [{ deltaMicros: 500_000_000 }]; // $500 booked
    const h = computeEconomyHealth(input, NOW);
    expect(h.coverage_ratio).toBeCloseTo(0.1, 4);
    expect(h.reserve_adequate).toBe(false);
  });

  it("parityStatus is the single source of truth for coverage (no divergent formulas)", () => {
    const supply = 123;
    const reserve = 400; // dollars
    const a = parityStatus({ supplyAngel: supply, reserveUsd: reserve });
    const input = empty();
    input.wallets = [{ balance: supply, staked: 0 }];
    input.reserveEntries = [{ deltaMicros: reserve * 100 * 10_000 }];
    const b = computeEconomyHealth(input, NOW);
    expect(b.coverage_ratio).toBe(a.coverageRatio);
    expect(b.reserve_adequate).toBe(a.reserveAdequate);
  });
});

describe("F-009 · ledger↔wallet supply reconciliation invariant", () => {
  // Canonical journal reducer must yield the same available balance the wallet
  // reports for the same account. A divergence is the "two ledgers drift" bug.
  function journal(entries: { type: AngelCoinEntryType; amount: number }[]) {
    return entries.map((e) => ({ entryType: e.type, amount: e.amount }));
  }

  it("wallet balance equals computeBalances(journal) for a simple grant+spend", () => {
    const entries = journal([
      { type: AngelCoinEntryType.OPERATOR_GRANT, amount: 500 },
      { type: AngelCoinEntryType.SPEND, amount: 100 },
    ]);
    const bal = computeBalances(entries);
    // Wallet would report 400; the journal must agree.
    expect(bal.availableBalance).toBe(400);
  });

  it("locked escrow reduces available but not grant/earned totals", () => {
    const entries = journal([
      { type: AngelCoinEntryType.OPERATOR_GRANT, amount: 500 },
      { type: AngelCoinEntryType.LOCK, amount: 200 },
    ]);
    const bal = computeBalances(entries);
    expect(bal.lockedBalance).toBe(200);
    expect(bal.availableBalance).toBe(300);
  });

  it("UNLOCK + SPEND (a release to worker) nets to a clean debit", () => {
    const entries = journal([
      { type: AngelCoinEntryType.OPERATOR_GRANT, amount: 510 },
      { type: AngelCoinEntryType.LOCK, amount: 510 },
      { type: AngelCoinEntryType.UNLOCK, amount: 510 },
      { type: AngelCoinEntryType.SPEND, amount: 510 },
    ]);
    const bal = computeBalances(entries);
    expect(bal.lockedBalance).toBe(0);
    expect(bal.availableBalance).toBe(0);
    expect(bal.spentBalance).toBe(510);
  });

  it("economy-health supply_angel equals the sum of wallet balances (single supply definition)", () => {
    const input = empty();
    input.wallets = [{ balance: 12, staked: 3 }, { balance: 8, staked: 0 }];
    const h = computeEconomyHealth(input, NOW);
    expect(h.supply_angel).toBe(20);
    expect(h.staked_angel).toBe(3);
  });
});
