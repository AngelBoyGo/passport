import { describe, it, expect } from "vitest";
import { mapAgentProfileToViewModel } from "@/lib/public-portal/profile-view-model";
import type { AgentProfile } from "@/lib/public-portal/portal-service";

const AGENT_HASH = "a".repeat(64);
const PHOTO_SHA = "f".repeat(64);

function baseProfile(
  overrides: Partial<AgentProfile> & {
    enrollment_status?: AgentProfile["enrollment_status"] | "ENROLLED_NO_EVIDENCE";
  } = {}
): AgentProfile & { enrollment_status?: AgentProfile["enrollment_status"] | "ENROLLED_NO_EVIDENCE" } {
  return {
    agent_commitment_hash: AGENT_HASH,
    enrollment_status: "UNENROLLED",
    presentation: null,
    first_observed_at: "2026-06-01T00:00:00.000Z",
    last_observed_at: "2026-06-02T00:00:00.000Z",
    totals: {
      evidence_count: 1,
      artifact_count: 1,
      correction_count: 0,
      failure_count: 0,
    },
    distributions: {
      normalized_event_type: { AGENT_ARTIFACT_CREATED: 1 },
      error_tranche: {},
    },
    timeline: [
      {
        source_type: "github_push_webhook",
        artifact_type: "commit",
        observed_at: "2026-06-02T00:00:00.000Z",
        session_log_available: false,
        validation_signal_present: false,
        outcome: "produced",
      },
    ],
    trend_windows: {
      "7d": {
        success_rate: 1,
        correction_rate: null,
        failure_rate: null,
        validation_visibility_rate: null,
        trace_visibility_rate: null,
      },
      "30d": {
        success_rate: 1,
        correction_rate: null,
        failure_rate: null,
        validation_visibility_rate: null,
        trace_visibility_rate: null,
      },
    },
    ...overrides,
  };
}

describe("mapAgentProfileToViewModel", () => {
  it("returns null for unknown profile input", () => {
    expect(mapAgentProfileToViewModel(null)).toBeNull();
  });

  it("maps enrolled_no_evidence to a distinct status label", () => {
    const view = mapAgentProfileToViewModel(
      baseProfile({ enrollment_status: "ENROLLED_NO_EVIDENCE" })
    );
    expect(view).not.toBeNull();
    expect(view!.enrollmentStatus).toBe("ENROLLED_NO_EVIDENCE");
    expect(view!.enrollmentStatusLabel).toMatch(/no public evidence/i);
    expect(view!.isEnrolledNoEvidence).toBe(true);
  });

  it("includes signed photo url and sha256 badge when presentation is present", () => {
    const view = mapAgentProfileToViewModel(
      baseProfile({
        enrollment_status: "ENROLLED",
        presentation: {
          url: "https://cdn.example.com/agent.png",
          content_sha256: PHOTO_SHA,
          mime_type: "image/png",
          updated_at: "2026-06-28T12:00:00.000Z",
        },
      })
    );
    expect(view!.photoUrl).toBe("https://cdn.example.com/agent.png");
    expect(view!.photoSha256Badge).toContain(PHOTO_SHA);
    expect(view!.showPhotoPlaceholder).toBe(false);
  });

  it("uses placeholder when enrolled agent has no photo", () => {
    const view = mapAgentProfileToViewModel(
      baseProfile({ enrollment_status: "ENROLLED", presentation: null })
    );
    expect(view!.photoUrl).toBeNull();
    expect(view!.photoSha256Badge).toBeNull();
    expect(view!.showPhotoPlaceholder).toBe(true);
  });

  it("maps commitment short hash and timeline rows", () => {
    const view = mapAgentProfileToViewModel(baseProfile());
    expect(view!.commitmentShort).toBe(AGENT_HASH.slice(0, 12));
    expect(view!.timelineRows).toHaveLength(1);
    expect(view!.timelineRows[0]).toMatchObject({
      outcome: "produced",
      sourceType: "github_push_webhook",
    });
  });
});
