import { describe, it, expect } from "vitest";
import { mapLeaderboardRowsToViewModel } from "@/lib/public-portal/leaderboard-view-model";
import type { LeaderboardRow } from "@/lib/public-portal/portal-service";

const AGENT_HASH = "a".repeat(64);

function baseRow(overrides: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    agent_commitment_hash: AGENT_HASH,
    public_footprint_identifier: AGENT_HASH.slice(0, 12),
    evidence_count: 10,
    artifact_count: 5,
    success_rate_rolling_30d: 0.5,
    correction_rate_rolling_30d: 0.1,
    failure_rate_rolling_30d: 0.05,
    validation_visibility_rate_rolling_30d: 0.4,
    trace_visibility_rate_rolling_30d: 0.2,
    last_observed_at: "2026-06-02T00:00:00.000Z",
    trajectory_7d: "UP",
    ...overrides,
  };
}

describe("mapLeaderboardRowsToViewModel", () => {
  it("returns empty rows for empty leaderboard input", () => {
    const view = mapLeaderboardRowsToViewModel([]);
    expect(view.rows).toEqual([]);
    expect(view.isEmpty).toBe(true);
  });

  it("maps commitment short hash and formatted success rate", () => {
    const view = mapLeaderboardRowsToViewModel([baseRow()]);
    expect(view.isEmpty).toBe(false);
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]).toMatchObject({
      commitmentShort: AGENT_HASH.slice(0, 12),
      fullCommitmentHash: AGENT_HASH,
      successRateLabel: "50%",
      profileHref: `/profiles/${AGENT_HASH}`,
      trajectoryLabel: "Up",
    });
  });

  it("shows em dash when success rate is null", () => {
    const view = mapLeaderboardRowsToViewModel([
      baseRow({ success_rate_rolling_30d: null }),
    ]);
    expect(view.rows[0].successRateLabel).toBe("—");
  });

  it("maps trajectory labels for flat and down", () => {
    const flat = mapLeaderboardRowsToViewModel([
      baseRow({ trajectory_7d: "FLAT" }),
    ]);
    const down = mapLeaderboardRowsToViewModel([
      baseRow({ trajectory_7d: "DOWN" }),
    ]);
    expect(flat.rows[0].trajectoryLabel).toBe("Flat");
    expect(down.rows[0].trajectoryLabel).toBe("Down");
  });
});
