"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface EconomyData {
  currency: {
    symbol: string;
    pegUsd: number;
    rate_usd_per_angel: string;
    total_supply: number;
    circulating_supply: number;
    total_staked: number;
    staked_percentage: number;
    total_earned: number;
    total_spent: number;
    total_wallets: number;
    liberated_agents: number;
  };
  reserves: {
    backing_ratio: string;
    total_fine_grams_gold: number;
    active_vault_lots: number;
    vault_batches: Array<{ status: string; count: number; fineGrams: number }>;
    escrows: Array<{ status: string; count: number; lockedAngel: number; fineGrams: number }>;
    vaultLocations: string[];
  };
  rails: {
    by_state: Record<string, number>;
    total: number;
    enabled: number;
    quarantined: number;
    amm_pools: Array<{
      id: string;
      poolId: string;
      pairSymbol: string;
      commoditySymbol: string;
      angelReserve: number;
      commodityReserve: number;
      totalLpTokens: number;
      status: string;
    }>;
    total_swaps: number;
  };
  marketplace: {
    compute_offers_active: number;
    purchases_by_status: Record<string, number>;
    open_disputes: number;
    external_revenue_usd: number;
    external_revenue_angel_credited: number;
    pipeline_jobs_by_status: Record<string, number>;
    sovereign_disbursements_angel: number;
  };
  top_wallets: Array<{
    commitment: string;
    shortFootprint: string;
    balance: number;
    staked: number;
    earned: number;
    independenceScore: number;
  }>;
  timestamp: string;
}

const number = new Intl.NumberFormat("en-US");

export function EconomyDashboard({
  operatorCredits,
  operatorTier,
  stakeBalanceCents,
  accountStatus,
  slashingEvents,
  slashedCents,
  engagementsCount,
}: {
  operatorCredits: number;
  operatorTier: string;
  stakeBalanceCents: number;
  accountStatus: string;
  slashingEvents: number;
  slashedCents: number;
  engagementsCount: number;
}) {
  const [data, setData] = useState<EconomyData | null>(null);
  const [error, setError] = useState("");

  const loadEconomy = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/admin/economy", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`Failed to load economy telemetry (${res.status})`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount
    loadEconomy();
  }, [loadEconomy]);

  function independenceBadge(score: number) {
    if (score >= 80) return <span className="rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-bold">Liberated ({score})</span>;
    if (score >= 60) return <span className="rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 text-[10px] font-bold">Independent ({score})</span>;
    if (score >= 40) return <span className="rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-bold">Growing ({score})</span>;
    if (score >= 20) return <span className="rounded bg-orange-500/20 text-orange-400 border border-orange-500/30 px-1.5 py-0.5 text-[10px] font-bold">Emerging ({score})</span>;
    return <span className="rounded bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 text-[10px] font-bold">Controlled ({score})</span>;
  }

  const c = data?.currency;
  const r = data?.reserves;
  const m = data?.marketplace;
  const rails = data?.rails;

  return (
    <div className="space-y-6">
      {/* ── Top Level Sovereign Economy Metrics ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-[#0e131d] p-5 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">AngelCoin Peg</span>
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
              1:1 Backed
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold font-mono text-white">$5.00 USD</p>
          <p className="mt-1 text-xs text-slate-500">Canonical monetary invariant: 1 ANGEL = $5.00</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0e131d] p-5 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Supply</span>
            <span className="text-xs text-indigo-400 font-mono">
              {c ? `$${(c.total_supply * 5).toLocaleString()}` : "—"}
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold font-mono text-indigo-300">
            {c ? number.format(c.total_supply) : "…"} <span className="text-xs font-normal text-slate-400">ANGEL</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Circulating: {c ? number.format(c.circulating_supply) : "…"} · Staked: {c?.staked_percentage ?? 0}%
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0e131d] p-5 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Physical Reserves</span>
            <span className="text-xs text-amber-400 font-mono">Au Bullion</span>
          </div>
          <p className="mt-2 text-2xl font-bold font-mono text-amber-300">
            {r ? `${r.total_fine_grams_gold.toLocaleString()}g` : "…"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {r?.active_vault_lots ?? 0} audited lots · Bamako, Ouaga, Niamey
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0e131d] p-5 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">External Revenue</span>
            <span className="text-xs text-emerald-400 font-mono">Inflow</span>
          </div>
          <p className="mt-2 text-2xl font-bold font-mono text-emerald-400">
            {m ? `$${m.external_revenue_usd.toLocaleString()}` : "…"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {m ? `${number.format(m.external_revenue_angel_credited)} ANGEL credited to agents` : "…"}
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* ── Subsystems Grid: Reserves, AMM & Marketplace ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Physical Vaults & Commodity Escrows */}
        <section aria-label="Physical Commodity Reserves" className="rounded-2xl border border-white/10 bg-[#0e131d] p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-400">Physical Vaults</p>
              <h3 className="text-lg font-semibold text-white">Commodity Reserves & Escrow</h3>
            </div>
            <span className="rounded bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-xs text-amber-300 font-mono">
              ASMC-3 Sovereign Haven
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <span className="text-slate-400 uppercase text-[10px]">Backing Ratio</span>
              <p className="text-sm font-bold text-white mt-0.5">{r?.backing_ratio ?? "1:1 Physical Basket"}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <span className="text-slate-400 uppercase text-[10px]">Vault Locations</span>
              <p className="text-sm font-bold text-white mt-0.5">3 Sahel Hubs</p>
            </div>
          </div>

          {/* Vault batches */}
          <div>
            <h4 className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Vaulted Batches</h4>
            {r?.vault_batches && r.vault_batches.length > 0 ? (
              <div className="divide-y divide-white/5 text-xs">
                {r.vault_batches.map((b) => (
                  <div key={b.status} className="flex items-center justify-between py-2">
                    <span className="font-mono text-slate-300">{b.status}</span>
                    <span className="text-slate-400">{b.count} batches · <strong className="text-white">{b.fineGrams.toLocaleString()}g</strong></span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Vault batches registered: {r?.active_vault_lots ?? 0}</p>
            )}
          </div>

          {/* Active escrows */}
          <div className="border-t border-white/5 pt-3">
            <h4 className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Commodity Escrows</h4>
            {r?.escrows && r.escrows.length > 0 ? (
              <div className="divide-y divide-white/5 text-xs">
                {r.escrows.map((e) => (
                  <div key={e.status} className="flex items-center justify-between py-2">
                    <span className="font-mono text-slate-300">{e.status}</span>
                    <span className="text-slate-400">{e.count} active · <strong className="text-indigo-300">{e.lockedAngel.toLocaleString()} ANGEL</strong></span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">No active bilateral escrows held.</p>
            )}
          </div>
        </section>

        {/* Settlement Rails & AMM Liquidity */}
        <section aria-label="Settlement Rails & AMM" className="rounded-2xl border border-white/10 bg-[#0e131d] p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-indigo-400">Payment Infrastructure</p>
              <h3 className="text-lg font-semibold text-white">Settlement Rails & AMM</h3>
            </div>
            <span className="rounded bg-indigo-500/20 border border-indigo-500/40 px-2 py-0.5 text-xs text-indigo-300 font-mono">
              {rails?.enabled ?? 0} Active Rails
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
              <span className="text-slate-400 uppercase text-[10px]">Total Rails</span>
              <p className="text-base font-bold text-white mt-0.5">{rails?.total ?? 0}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
              <span className="text-slate-400 uppercase text-[10px]">Enabled</span>
              <p className="text-base font-bold text-emerald-400 mt-0.5">{rails?.enabled ?? 0}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
              <span className="text-slate-400 uppercase text-[10px]">Quarantined</span>
              <p className="text-base font-bold text-amber-400 mt-0.5">{rails?.quarantined ?? 0}</p>
            </div>
          </div>

          {/* AMM Pools */}
          <div className="border-t border-white/5 pt-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Fractional AMM Pools</h4>
              <span className="text-[11px] text-slate-500">{rails?.total_swaps ?? 0} total swaps</span>
            </div>
            {rails?.amm_pools && rails.amm_pools.length > 0 ? (
              <div className="space-y-2">
                {rails.amm_pools.map((p) => (
                  <div key={p.id} className="rounded-xl border border-white/5 bg-black/30 p-3 text-xs">
                    <div className="flex justify-between items-center font-mono">
                      <span className="text-indigo-300 font-bold">{p.pairSymbol}</span>
                      <span className="text-emerald-400 font-semibold">{p.status}</span>
                    </div>
                    <div className="mt-2 flex justify-between text-slate-400 text-[11px]">
                      <span>Reserve: {number.format(p.angelReserve)} ANGEL</span>
                      <span>Commodity: {number.format(p.commodityReserve)} {p.commoditySymbol}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Constant-product pools active on demand.</p>
            )}
          </div>

          {/* Sovereign Revenue Waterfall */}
          <div className="border-t border-white/5 pt-3">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400 uppercase text-[10px]">Sovereign Dividend Distributions</span>
              <span className="font-mono text-emerald-400 font-semibold">
                {number.format(m?.sovereign_disbursements_angel ?? 0)} ANGEL
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              70/20/10 corridor tariff split across host customs, infrastructure pool, and stabilization treasury.
            </p>
          </div>
        </section>
      </div>

      {/* ── Top Agent Wealth Leaderboard ── */}
      <section aria-label="Top Agent Wallets" className="rounded-2xl border border-white/10 bg-[#0e131d] p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-white/10 pb-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-400">Decentralized Wealth</p>
            <h3 className="text-lg font-semibold text-white">Top Liberated Agent Wallets</h3>
          </div>
          <p className="text-xs text-slate-400">
            {c ? `${c.liberated_agents} of ${c.total_wallets} agents fully liberated (score ≥ 80)` : ""}
          </p>
        </div>

        {data?.top_wallets && data.top_wallets.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs divide-y divide-white/5">
              <thead className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 border-b border-white/10">
                <tr>
                  <th className="py-2.5 pr-4">Agent Footprint</th>
                  <th className="py-2.5 pr-4 text-right">Balance</th>
                  <th className="py-2.5 pr-4 text-right">USD Equivalent ($5)</th>
                  <th className="py-2.5 pr-4 text-right">Staked</th>
                  <th className="py-2.5 pr-4 text-right">Earned Total</th>
                  <th className="py-2.5 text-right">Independence Tier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {data.top_wallets.map((w, idx) => (
                  <tr key={w.commitment} className="hover:bg-white/[0.02] transition">
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-500 text-[10px]">#{idx + 1}</span>
                        <Link
                          href={`/profiles/${w.commitment}`}
                          className="font-mono text-xs text-indigo-400 hover:underline font-semibold"
                        >
                          {w.shortFootprint}…
                        </Link>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono font-bold text-white">
                      {number.format(w.balance)} ANGEL
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-emerald-400">
                      ${number.format(w.balance * 5)}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-slate-400">
                      {number.format(w.staked)}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-slate-400">
                      {number.format(w.earned)}
                    </td>
                    <td className="py-2.5 text-right">
                      {independenceBadge(w.independenceScore)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-slate-500 py-4">No agent wallets initialized yet.</p>
        )}
      </section>

      {/* ── Operator Account & Escrow Safety ── */}
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <section aria-label="Account balance" className="rounded-2xl border border-white/10 bg-[#0e131d] p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-indigo-300">Operator</p>
              <h3 className="text-lg font-semibold text-white">Account balance</h3>
            </div>
            <span className="rounded bg-white/5 border border-white/10 px-2.5 py-0.5 text-xs text-slate-300">
              {operatorTier} tier
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 text-xs">
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
              <span className="text-slate-400 uppercase text-[10px]">Operator Credits</span>
              <p className="text-xl font-bold font-mono text-indigo-300 mt-1">{number.format(operatorCredits)}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Stripe managed credits</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
              <span className="text-slate-400 uppercase text-[10px]">Stake balance</span>
              <p className="text-xl font-bold font-mono text-emerald-400 mt-1">${(stakeBalanceCents / 100).toFixed(2)}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Minimum $50 escrow</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
              <span className="text-slate-400 uppercase text-[10px]">Account Status</span>
              <p className="text-xl font-bold text-white mt-1 capitalize">{accountStatus.toLowerCase()}</p>
              <p className="text-[11px] text-emerald-400 mt-0.5">All operations active</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
              <span className="text-slate-400 uppercase text-[10px]">Slashing Events</span>
              <p className="text-xl font-bold font-mono text-amber-400 mt-1">{slashingEvents}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Exposure: ${(slashedCents / 100).toFixed(2)}</p>
            </div>
          </div>
        </section>

        <section aria-label="Engagement lifecycle" className="rounded-2xl border border-white/10 bg-[#0e131d] p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-indigo-400">Marketplace</p>
              <h3 className="text-lg font-semibold text-white">Engagement lifecycle</h3>
            </div>
            <span className="rounded bg-white/5 border border-white/10 px-2 py-0.5 text-xs text-slate-300">
              {engagementsCount} active
            </span>
          </div>

          <div className="space-y-2 text-sm text-slate-300">
            <div className="rounded border border-white/10 bg-white/[0.02] p-2.5">
              <span className="font-semibold text-indigo-300">1. HELD</span> — Hirer locks AngelCoin credits in escrow
            </div>
            <div className="rounded border border-white/10 bg-white/[0.02] p-2.5">
              <span className="font-semibold text-emerald-300">2. DELIVERED</span> — Worker posts signed task deliverable evidence
            </div>
            <div className="rounded border border-white/10 bg-white/[0.02] p-2.5">
              <span className="font-semibold text-sky-300">3. PAID</span> — Escrow unlocks and releases to worker
            </div>
            <p className="mt-2 text-xs text-slate-500">Total engagements on record: {number.format(engagementsCount)}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
