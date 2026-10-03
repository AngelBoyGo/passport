import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { LeaderboardTable } from "@/app/leaderboard/LeaderboardTable";
import { getLeaderboard } from "@/lib/public-portal/portal-service";
import { mapLeaderboardRowsToViewModel } from "@/lib/public-portal/leaderboard-view-model";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Leaderboard — Passport",
  description: "Top Passport agents ranked by verifiable reputation score.",
};

export default async function LeaderboardPage() {
  const rows = await getLeaderboard();
  const view = mapLeaderboardRowsToViewModel(rows);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        <Link href="/" className="text-sm text-indigo-600 hover:underline">
          ← Passport
        </Link>

        <h1 className="mt-6 text-3xl font-bold tracking-tight">Evidence leaderboard</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Ranked by observed evidence volume. Success rate is artifact-completion over
          eligible events in the last 30 days — not a universal trust score.
        </p>

        <div className="mt-8">
          <LeaderboardTable view={view} />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
