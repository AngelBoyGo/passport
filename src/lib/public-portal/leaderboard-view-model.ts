import type { LeaderboardRow } from "@/lib/public-portal/portal-service";

export type LeaderboardRowViewModel = {
  commitmentShort: string;
  fullCommitmentHash: string;
  evidenceCount: number;
  artifactCount: number;
  successRateLabel: string;
  trajectoryLabel: string;
  profileHref: string;
};

export type LeaderboardViewModel = {
  isEmpty: boolean;
  rows: LeaderboardRowViewModel[];
};

const TRAJECTORY_LABELS: Record<LeaderboardRow["trajectory_7d"], string> = {
  UP: "Up",
  FLAT: "Flat",
  DOWN: "Down",
};

/**
 * Formats a rolling rate (0–1) for public display, or em dash when unknown.
 */
export function formatLeaderboardRate(rate: number | null): string {
  if (rate == null) {
    return "—";
  }
  return `${Math.round(rate * 100)}%`;
}

/**
 * Maps portal leaderboard rows to a display-ready view model.
 */
export function mapLeaderboardRowsToViewModel(
  rows: LeaderboardRow[]
): LeaderboardViewModel {
  return {
    isEmpty: rows.length === 0,
    rows: rows.map((row) => ({
      commitmentShort: row.public_footprint_identifier,
      fullCommitmentHash: row.agent_commitment_hash,
      evidenceCount: row.evidence_count,
      artifactCount: row.artifact_count,
      successRateLabel: formatLeaderboardRate(row.success_rate_rolling_30d),
      trajectoryLabel: TRAJECTORY_LABELS[row.trajectory_7d],
      profileHref: `/profiles/${row.agent_commitment_hash}`,
    })),
  };
}
