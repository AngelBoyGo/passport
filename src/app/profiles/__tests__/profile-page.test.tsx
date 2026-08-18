import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ProfileCard } from "@/app/profiles/ProfileCard";
import type { ProfileViewModel } from "@/lib/public-portal/profile-view-model";

const PHOTO_SHA = "f".repeat(64);

const baseViewModel: ProfileViewModel = {
  commitmentShort: "aaaaaaaaaaaa",
  fullCommitmentHash: "a".repeat(64),
  enrollmentStatus: "ENROLLED",
  enrollmentStatusLabel: "Enrolled",
  isEnrolledNoEvidence: false,
  photoUrl: null,
  photoSha256Badge: null,
  showPhotoPlaceholder: true,
  firstObservedAt: null,
  lastObservedAt: null,
  timelineRows: [],
  totals: {
    evidenceCount: 1,
    artifactCount: 1,
    correctionCount: 0,
    failureCount: 0,
  },
  sourceBreakdown: [],
  projectSummary: [],
  attributes: [],
  archetype: "Generalist",
  activitySummary: "Active agent",
  trendWindows: {
    "7d": { successRate: null, correctionRate: null, failureRate: null },
    "30d": { successRate: null, correctionRate: null, failureRate: null },
  },
};

describe("ProfileCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders photo placeholder when no signed photo", () => {
    render(<ProfileCard view={baseViewModel} />);
    expect(screen.getByTestId("profile-photo-placeholder")).toBeInTheDocument();
  });

  it("renders signed photo url and sha256 badge", () => {
    render(
      <ProfileCard
        view={{
          ...baseViewModel,
          photoUrl: "https://cdn.example.com/agent.png",
          photoSha256Badge: `SHA-256 ${PHOTO_SHA}`,
          showPhotoPlaceholder: false,
        }}
      />
    );
    const img = screen.getByRole("img", { name: /agent profile photo/i });
    expect(img).toHaveAttribute("src", "https://cdn.example.com/agent.png");
    expect(screen.getByText(/SHA-256/)).toHaveTextContent(PHOTO_SHA);
  });

  it("shows enrolled_no_evidence status label", () => {
    render(
      <ProfileCard
        view={{
          ...baseViewModel,
          enrollmentStatus: "ENROLLED_NO_EVIDENCE",
          enrollmentStatusLabel: "Enrolled — no public evidence",
          isEnrolledNoEvidence: true,
        }}
      />
    );
    expect(screen.getByTestId("enrollment-status")).toHaveTextContent(
      /no public evidence/i
    );
  });
});
