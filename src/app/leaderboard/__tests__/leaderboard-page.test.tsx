import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LeaderboardTable } from "@/app/leaderboard/LeaderboardTable";
import type { LeaderboardViewModel } from "@/lib/public-portal/leaderboard-view-model";

const AGENT_HASH = "a".repeat(64);

const emptyView: LeaderboardViewModel = {
  isEmpty: true,
  rows: [],
};

const singleRowView: LeaderboardViewModel = {
  isEmpty: false,
  rows: [
    {
      commitmentShort: AGENT_HASH.slice(0, 12),
      fullCommitmentHash: AGENT_HASH,
      evidenceCount: 10,
      artifactCount: 5,
      successRateLabel: "50%",
      trajectoryLabel: "Up",
      profileHref: `/profiles/${AGENT_HASH}`,
    },
  ],
};

describe("LeaderboardTable", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders empty state when no agents ranked", () => {
    render(<LeaderboardTable view={emptyView} />);
    expect(screen.getByTestId("leaderboard-empty")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders row with commitment short hash and success rate", () => {
    render(<LeaderboardTable view={singleRowView} />);
    expect(screen.getByTestId("leaderboard-table")).toBeInTheDocument();
    expect(screen.getByText(AGENT_HASH.slice(0, 12))).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });
});
