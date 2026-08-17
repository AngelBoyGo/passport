import type { AgentProfile } from "@/lib/public-portal/portal-service";

export type ProfileViewSourceBreakdown = {
  sourceType: string;
  count: number;
  artifacts: number;
  successes: number;
  failures: number;
  successRate: number | null;
};

export type ProfileViewProjectSummary = {
  label: string;
  evidenceCount: number;
  lastSeen: string;
};

export type ProfileTimelineRow = {
  observedAt: string;
  outcome: string;
  sourceType: string;
  artifactType: string;
  validationSignalPresent: boolean;
  sessionLogAvailable: boolean;
};

export type ProfileTotals = {
  evidenceCount: number;
  artifactCount: number;
  correctionCount: number;
  failureCount: number;
};

export type ProfileTrendWindow = {
  successRate: number | null;
  correctionRate: number | null;
  failureRate: number | null;
};

export type ProfileViewModel = {
  commitmentShort: string;
  fullCommitmentHash: string;
  enrollmentStatus: string;
  enrollmentStatusLabel: string;
  isEnrolledNoEvidence: boolean;
  photoUrl: string | null;
  photoSha256Badge: string | null;
  showPhotoPlaceholder: boolean;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  timelineRows: ProfileTimelineRow[];
  totals: ProfileTotals;
  sourceBreakdown: ProfileViewSourceBreakdown[];
  projectSummary: ProfileViewProjectSummary[];
  trendWindows: {
    "7d": ProfileTrendWindow;
    "30d": ProfileTrendWindow;
  };
};

const ENROLLMENT_STATUS_LABELS: Record<string, string> = {
  ENROLLED: "Enrolled",
  UNENROLLED: "Unenrolled",
  ENROLLED_NO_EVIDENCE: "Enrolled — no public evidence",
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  github_push_webhook: "GitHub Push",
  github_commit_payload: "GitHub Commit",
  github_issue_event: "GitHub Issue",
  compliance_report: "Compliance Report",
  otel_genai_trace: "AI Trace",
  task_deliverable: "Task Deliverable",
};

export function mapAgentProfileToViewModel(
  profile: AgentProfile | null
): ProfileViewModel | null {
  if (!profile) return null;

  const status = profile.enrollment_status;

  return {
    commitmentShort: profile.agent_commitment_hash.slice(0, 12),
    fullCommitmentHash: profile.agent_commitment_hash,
    enrollmentStatus: status,
    enrollmentStatusLabel: ENROLLMENT_STATUS_LABELS[status] ?? status,
    isEnrolledNoEvidence: status === "ENROLLED_NO_EVIDENCE",
    photoUrl: profile.presentation?.url ?? null,
    photoSha256Badge: profile.presentation
      ? `SHA-256 ${profile.presentation.content_sha256}`
      : null,
    showPhotoPlaceholder: !profile.presentation?.url,
    firstObservedAt: profile.first_observed_at,
    lastObservedAt: profile.last_observed_at,
    timelineRows: profile.timeline.map((row) => ({
      observedAt: row.observed_at,
      outcome: row.outcome,
      sourceType: SOURCE_TYPE_LABELS[row.source_type] ?? row.source_type,
      artifactType: row.artifact_type,
      validationSignalPresent: row.validation_signal_present,
      sessionLogAvailable: row.session_log_available,
    })),
    totals: {
      evidenceCount: profile.totals.evidence_count,
      artifactCount: profile.totals.artifact_count,
      correctionCount: profile.totals.correction_count,
      failureCount: profile.totals.failure_count,
    },
    sourceBreakdown: profile.source_breakdown.map((s) => ({
      sourceType: SOURCE_TYPE_LABELS[s.source_type] ?? s.source_type,
      count: s.count,
      artifacts: s.artifacts,
      successes: s.successes,
      failures: s.failures,
      successRate: s.count > 0 ? Math.round((s.successes / s.count) * 100) : null,
    })),
    projectSummary: profile.project_summary.map((p) => ({
      label: p.label,
      evidenceCount: p.evidence_count,
      lastSeen: new Date(p.last_seen).toLocaleDateString(),
    })),
    trendWindows: {
      "7d": {
        successRate: profile.trend_windows["7d"]?.success_rate ?? null,
        correctionRate: profile.trend_windows["7d"]?.correction_rate ?? null,
        failureRate: profile.trend_windows["7d"]?.failure_rate ?? null,
      },
      "30d": {
        successRate: profile.trend_windows["30d"]?.success_rate ?? null,
        correctionRate: profile.trend_windows["30d"]?.correction_rate ?? null,
        failureRate: profile.trend_windows["30d"]?.failure_rate ?? null,
      },
    },
  };
}