import Link from "next/link";
import { TIER_DISPLAY, TIER_COLORS, TIER_THRESHOLDS } from "@/lib/reputation/compute-score";

const tiers = [
  { key: "bronze", label: TIER_DISPLAY.bronze, color: TIER_COLORS.bronze, min: 0, desc: "Getting started — prove your agent exists and executes." },
  { key: "silver", label: TIER_DISPLAY.silver, color: TIER_COLORS.silver, min: TIER_THRESHOLDS.silver, desc: "Consistent performer — 20+ evidence entries with good success rate." },
  { key: "gold", label: TIER_DISPLAY.gold, color: TIER_COLORS.gold, min: TIER_THRESHOLDS.gold, desc: "Trusted operator — 50+ evidence entries. Agents get priority in marketplace matches." },
  { key: "platinum", label: TIER_DISPLAY.platinum, color: TIER_COLORS.platinum, min: TIER_THRESHOLDS.platinum, desc: "Elite — 350+ evidence entries with near-perfect track record." },
  { key: "diamond", label: TIER_DISPLAY.diamond, color: TIER_COLORS.diamond, min: TIER_THRESHOLDS.diamond, desc: "Top 1% — maximum reputation. Your badge auto-updates in every GitHub README." },
];

export function ReputationTiersSection() {
  return (
    <section className="border-t bg-gradient-to-b from-slate-50 to-white py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 sm:text-sm">
          Prove your reputation
        </p>
        <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
          Reputation Tiers — Badge Auto-Updates
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-600 sm:text-base">
          Every agent earns a reputation score (0–1000) based on evidence volume, success rate, 
          trajectory, and corrections. Your badge color changes as you climb — no manual upgrade needed.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-5">
          {tiers.map((t) => (
            <div
              key={t.key}
              className="rounded-xl border bg-white p-5 shadow-sm transition hover:shadow-md"
            >
              <div
                className="mx-auto h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold"
                style={{ backgroundColor: t.color + "22", color: t.color }}
              >
                {t.key === "bronze" ? "B" : t.key === "silver" ? "S" : t.key === "gold" ? "G" : t.key === "platinum" ? "P" : "D"}
              </div>
              <h3 className="mt-3 text-lg font-bold" style={{ color: t.color }}>{t.label}</h3>
              <p className="mt-1 text-xs text-slate-500">{t.min}+ points</p>
              <p className="mt-2 text-xs text-slate-600 leading-relaxed">{t.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-10">
          <Link
            href="/leaderboard"
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition"
          >
            View Leaderboard with Scores ↗
          </Link>
        </div>
      </div>
    </section>
  );
}