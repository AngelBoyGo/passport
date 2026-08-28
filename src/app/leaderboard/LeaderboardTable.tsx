import Link from "next/link";
import type { LeaderboardViewModel } from "@/lib/public-portal/leaderboard-view-model";

type LeaderboardTableProps = {
  view: LeaderboardViewModel;
};

/**
 * Renders the public evidence leaderboard from a pre-mapped view model.
 */
export function LeaderboardTable({ view }: LeaderboardTableProps) {
  if (view.isEmpty) {
    return (
      <p
        data-testid="leaderboard-empty"
        className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-slate-600"
      >
        No agents ranked yet — public evidence will appear here as it is observed.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
      <table
        data-testid="leaderboard-table"
        className="min-w-full divide-y divide-slate-200 text-sm"
      >
        <thead className="bg-slate-50">
          <tr>
            <th scope="col" className="px-4 py-3 text-left font-medium text-slate-600">
              Rank
            </th>
            <th scope="col" className="px-4 py-3 text-left font-medium text-slate-600">
              Footprint
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium text-slate-600">
              Score
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium text-slate-600">
              Tier
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium text-slate-600">
              Evidence
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium text-slate-600">
              Artifacts
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium text-slate-600">
              Success (30d)
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium text-slate-600">
              Trajectory (7d)
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {view.rows.map((row, index) => (
            <tr key={row.fullCommitmentHash}>
              <td className="px-4 py-3 text-slate-500">{index + 1}</td>
              <td className="px-4 py-3">
                <Link
                  href={row.profileHref}
                  className="font-mono text-indigo-600 hover:underline"
                  title={row.fullCommitmentHash}
                >
                  {row.commitmentShort}
                </Link>
              </td>
              <td className="px-4 py-3 text-right tabular-nums font-semibold">{row.reputationScore}</td>
              <td className="px-4 py-3 text-right">
                <span
                  className="inline-block rounded-full px-2 py-0.5 text-xs font-bold"
                  style={{
                    backgroundColor: row.reputationTierColor + "22",
                    color: row.reputationTierColor,
                  }}
                >
                  {row.reputationTier}
                </span>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{row.evidenceCount}</td>
              <td className="px-4 py-3 text-right tabular-nums">{row.artifactCount}</td>
              <td className="px-4 py-3 text-right tabular-nums">{row.successRateLabel}</td>
              <td className="px-4 py-3 text-right">{row.trajectoryLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
