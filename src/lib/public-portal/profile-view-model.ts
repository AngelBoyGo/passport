import type { AgentProfile } from "@/lib/public-portal/portal-service";

/** Extended for frontend display before portal-service lands enrolled_no_evidence. */
export type ProfileEnrollmentStatus =
  | AgentProfile["enrollment_status"]
  | "ENROLLED_NO_EVIDENCE";

export type ProfileViewModelInput = Omit<AgentProfile, "enrollment_status"> & {
  enrollment_status: ProfileEnrollmentStatus;
};

export type ProfileTimelineRow = {
  observedAt: string;
  outcome: string;
  sourceType: string;
  artifactType: string;
  validationSignalPresent: boolean;
  sessionLogAvailable: boolean;
};

export type ProfileViewModel = {
  commitmentShort: string;
  fullCommitmentHash: string;
  enrollmentStatus: ProfileEnrollmentStatus;
  enrollmentStatusLabel: string;
  isEnrolledNoEvidence: boolean;
  photoUrl: string | null;
  photoSha256Badge: string | null;
  showPhotoPlaceholder: boolean;
  timelineRows: ProfileTimelineRow[];
  totals: {
    evidenceCount: number;
    artifactCount: number;
  };
};

const ENROLLMENT_STATUS_LABELS: Record<ProfileEnrollmentStatus, string> = {
  ENROLLED: "Enrolled",
  UNENROLLED: "Unenrolled",
  ENROLLED_NO_EVIDENCE: "Enrolled — no public evidence",
};

/**
 * Maps a portal AgentProfile (or null) to a display-ready view model.
 */
export function mapAgentProfileToViewModel(
  profile: ProfileViewModelInput | null
): ProfileViewModel | null {
  if (!profile) {
    return null;
  }

  const enrollmentStatus = profile.enrollment_status;
  const presentation = profile.presentation;

  return {
    commitmentShort: profile.agent_commitment_hash.slice(0, 12),
    fullCommitmentHash: profile.agent_commitment_hash,
    enrollmentStatus,
    enrollmentStatusLabel: ENROLLMENT_STATUS_LABELS[enrollmentStatus],
    isEnrolledNoEvidence: enrollmentStatus === "ENROLLED_NO_EVIDENCE",
    photoUrl: presentation?.url ?? null,
    photoSha256Badge: presentation
      ? `SHA-256 ${presentation.content_sha256}`
      : null,
    showPhotoPlaceholder: !presentation?.url,
    timelineRows: profile.timeline.map((row) => ({
      observedAt: row.observed_at,
      outcome: row.outcome,
      sourceType: row.source_type,
      artifactType: row.artifact_type,
      validationSignalPresent: row.validation_signal_present,
      sessionLogAvailable: row.session_log_available,
    })),
    totals: {
      evidenceCount: profile.totals.evidence_count,
      artifactCount: profile.totals.artifact_count,
    },
  };
}
