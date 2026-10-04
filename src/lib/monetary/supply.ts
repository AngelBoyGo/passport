/**
 * Canonical ANGEL supply accounting.
 *
 * AUDIT FIX (two-ledger divergence): circulating supply was multiplied across
 * the codebase as `Σ AgentWallet.balance`, while a second, independent ledger
 * (`AngelCoinAccount` journal) tracked granted/earned/spent/locked balances.
 * A grant could therefore raise the journal balance without appearing in the
 * supply the solvency gate checks — the two could silently drift.
 *
 * This module is the SINGLE definition of circulating supply. The invariant:
 *
 *   circulating supply = Σ AgentWallet.balance
 *
 * and any issuance primitive (grantCredits, buy-on-behalf, mobile-money, bridge
 * deposit) that writes the journal MUST also credit AgentWallet.balance in the
 * same transaction, so the journal-derived balance and the supply counter stay
 * consistent by construction.
 */

import { prisma } from "@/lib/db";

export interface SupplySnapshot {
  /** Sum of wallet balances (what the receipt / parity / solvency use). */
  supply: number;
  /** Sum of staked balances. */
  staked: number;
  /** supply - staked, floored at 0. */
  circulating: number;
  walletCount: number;
}

/** In-memory aggregation over already-fetched wallet rows (pure, testable). */
export function supplyFromWallets(wallets: { balance: number; staked?: number }[]): SupplySnapshot {
  const supply = wallets.reduce((s, w) => s + (w.balance || 0), 0);
  const staked = wallets.reduce((s, w) => s + (w.staked || 0), 0);
  return {
    supply,
    staked,
    circulating: Math.max(0, supply - staked),
    walletCount: wallets.length,
  };
}

/** Loads the canonical supply snapshot from the DB. */
export async function circulatingSupply(): Promise<SupplySnapshot> {
  const wallets = await prisma.agentWallet.findMany({ select: { balance: true, staked: true } });
  return supplyFromWallets(wallets);
}
