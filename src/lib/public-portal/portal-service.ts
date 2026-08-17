import { prisma } from "@/lib/db";
import {
  dbReceiptToPayload,
  getReceiptWithHistory,
} from "@/lib/receipt-service";
import { verifyReceipt } from "@/lib/receipt/verify";
import { operatorIdFromStripe } from "@/lib/operator";
import { resolveEnrollmentStatus } from "@/lib/enrollment/evidence-binding";
import { getPresentation } from "@/lib/enrollment/presentation-service";
import type { AgentPresentation } from "@/lib/enrollment/presentation";

/** Evidence row fields used for rate computation. */
export type EvidenceRateInput = {
  normalizedEventType: string;
  rawErrorClassification?: string | null;
  validationSignalPresent: boolean;
  sessionLogUrlCommitment: string | null;
  sourceType: string;
};

/**
 * Eligible observed evidence unit (event-based, NOT run/session-based).
 *
 * Phase 1 has no reliable run/session dedup — rates reflect normalized evidence
 * rows in-window, not session-level truth. Denominator = rows whose
 * normalizedEventType is AGENT_RUN_OBSERVED or AGENT_ARTIFACT_CREATED.
 */
const ELIGIBLE_EVENT_TYPES = new Set([
  "AGENT_RUN_OBSERVED",
  "AGENT_ARTIFACT_CREATED",
]);

export type PortalRates = {
  success_rate: number | null;
  correction_rate: number | null;
  failure_rate: number | null;
  validation_visibility_rate: number | null;
  trace_visibility_rate: number | null;
};

/** Additive timeline outcome label derived from normalizedEventType. */
export type EvidenceOutcomeLabel =
  | "produced"
  | "validated"
  | "corrected"
  | "failed"
  | "observed";

/**
 * Maps normalized event type to a public timeline outcome label.
 */
export function evidenceOutcomeLabel(
  normalizedEventType: string
): EvidenceOutcomeLabel {
  switch (normalizedEventType) {
    case "AGENT_ARTIFACT_CREATED":
      return "produced";
    case "VALIDATION_OBSERVED":
      return "validated";
    case "HUMAN_CORRECTION_OBSERVED":
      return "corrected";
    case "EXECUTION_FAILURE_OBSERVED":
      return "failed";
    case "AGENT_RUN_OBSERVED":
    default:
      return "observed";
  }
}

/**
 * Computes explainable portal rates from in-window evidence rows.
 * success_rate is conservatively artifact-completion (AGENT_ARTIFACT_CREATED / eligible),
 * not a quality/success judgment.
 */
export function computeRates(events: EvidenceRateInput[]): PortalRates {
  const eligible = events.filter((e) =>
    ELIGIBLE_EVENT_TYPES.has(e.normalizedEventType)
  );
  if (eligible.length === 0) {
    return {
      success_rate: null,
      correction_rate: null,
      failure_rate: null,
      validation_visibility_rate: null,
      trace_visibility_rate: null,
    };
  }

  const denom = eligible.length;
  const artifactCount = eligible.filter(
    (e) => e.normalizedEventType === "AGENT_ARTIFACT_CREATED"
  ).length;
  const correctionCount = events.filter(
    (e) => e.normalizedEventType === "HUMAN_CORRECTION_OBSERVED"
  ).length;
  const failureCount = events.filter(
    (e) => e.normalizedEventType === "EXECUTION_FAILURE_OBSERVED"
  ).length;
  const validationCount = eligible.filter((e) => e.validationSignalPresent)
    .length;
  const traceCount = eligible.filter(
    (e) =>
      e.sessionLogUrlCommitment != null || e.sourceType === "otel_genai_trace"
  ).length;

  return {
    success_rate: artifactCount / denom,
    correction_rate: correctionCount / denom,
    failure_rate: failureCount / denom,
    validation_visibility_rate: validationCount / denom,
    trace_visibility_rate: traceCount / denom,
  };
}

const EVIDENCE_SELECT = {
  normalizedEventType: true,
  rawErrorClassification: true,
  validationSignalPresent: true,
  sessionLogUrlCommitment: true,
  sourceType: true,
  artifactType: true,
  observedAt: true,
  agentIdentityCommitment: true,
  commitSha: true,
  externalTaskId: true,
  repositoryCommitment: true,
  sourceUrl: true,
} as const;

type EvidenceRow = {
  normalizedEventType: string;
  rawErrorClassification: string | null;
  validationSignalPresent: boolean;
  sessionLogUrlCommitment: string | null;
  sourceType: string;
  artifactType: string;
  observedAt: Date;
  agentIdentityCommitment: string;
  commitSha: string | null;
  externalTaskId: string | null;
  repositoryCommitment: string | null;
  sourceUrl: string | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function windowStart(days: number): Date {
  return new Date(Date.now() - days * MS_PER_DAY);
}

/**
 * Artifact-completion minus correction score for trajectory comparison.
 */
function netCompletionScore(events: EvidenceRateInput[]): number | null {
  const rates = computeRates(events);
  if (rates.success_rate == null || rates.correction_rate == null) {
    return null;
  }
  return rates.success_rate - rates.correction_rate;
}

/**
 * Compares last-7d vs prior-7d net completion; insufficient data -> FLAT.
 */
export function computeTrajectory7d(
  events7d: EvidenceRateInput[],
  eventsPrior7d: EvidenceRateInput[]
): "UP" | "FLAT" | "DOWN" {
  const current = netCompletionScore(events7d);
  const prior = netCompletionScore(eventsPrior7d);
  if (current == null || prior == null) {
    return "FLAT";
  }
  if (current > prior) return "UP";
  if (current < prior) return "DOWN";
  return "FLAT";
}

export type LeaderboardRow = {
  agent_commitment_hash: string;
  public_footprint_identifier: string;
  evidence_count: number;
  artifact_count: number;
  success_rate_rolling_30d: number | null;
  correction_rate_rolling_30d: number | null;
  failure_rate_rolling_30d: number | null;
  validation_visibility_rate_rolling_30d: number | null;
  trace_visibility_rate_rolling_30d: number | null;
  last_observed_at: string;
  trajectory_7d: "UP" | "FLAT" | "DOWN";
};

/**
 * Leaderboard: step 1 groupBy totals, step 2 per-agent windowed queries + JS rates.
 */
export async function getLeaderboard(opts: {
  limit?: number;
} = {}): Promise<LeaderboardRow[]> {
  const limit = opts.limit ?? 20;

  const grouped = await prisma.agentEvidence.groupBy({
    by: ["agentIdentityCommitment"],
    _count: { _all: true },
    _max: { observedAt: true },
  });

  const topAgents = grouped
    .sort((a, b) => b._count._all - a._count._all)
    .slice(0, limit);

  const since30d = windowStart(30);
  const since7d = windowStart(7);
  const since14d = windowStart(14);

  const rows = await Promise.all(
    topAgents.map(async (g) => {
      const hash = g.agentIdentityCommitment;

      const [events30d, events7d, eventsPrior7d, artifactCount] =
        await Promise.all([
          prisma.agentEvidence.findMany({
            where: {
              agentIdentityCommitment: hash,
              observedAt: { gte: since30d },
            },
            select: EVIDENCE_SELECT,
          }),
          prisma.agentEvidence.findMany({
            where: {
              agentIdentityCommitment: hash,
              observedAt: { gte: since7d },
            },
            select: EVIDENCE_SELECT,
          }),
          prisma.agentEvidence.findMany({
            where: {
              agentIdentityCommitment: hash,
              observedAt: { gte: since14d, lt: since7d },
            },
            select: EVIDENCE_SELECT,
          }),
          prisma.agentEvidence.count({
            where: {
              agentIdentityCommitment: hash,
              normalizedEventType: "AGENT_ARTIFACT_CREATED",
            },
          }),
        ]);

      const rates30d = computeRates(events30d);

      return {
        agent_commitment_hash: hash,
        public_footprint_identifier: hash.slice(0, 12),
        evidence_count: g._count._all,
        artifact_count: artifactCount,
        success_rate_rolling_30d: rates30d.success_rate,
        correction_rate_rolling_30d: rates30d.correction_rate,
        failure_rate_rolling_30d: rates30d.failure_rate,
        validation_visibility_rate_rolling_30d:
          rates30d.validation_visibility_rate,
        trace_visibility_rate_rolling_30d: rates30d.trace_visibility_rate,
        last_observed_at: g._max.observedAt!.toISOString(),
        trajectory_7d: computeTrajectory7d(events7d, eventsPrior7d),
      };
    })
  );

  return rows;
}

export type AgentProfile = {
  agent_commitment_hash: string;
  enrollment_status: "ENROLLED" | "UNENROLLED" | "ENROLLED_NO_EVIDENCE";
  presentation: AgentPresentation | null;
  first_observed_at: string | null;
  last_observed_at: string | null;
  totals: {
    evidence_count: number;
    artifact_count: number;
    correction_count: number;
    failure_count: number;
  };
  distributions: {
    normalized_event_type: Record<string, number>;
    error_tranche: Record<string, number>;
  };
  source_breakdown: Array<{
    source_type: string;
    count: number;
    artifacts: number;
    successes: number;
    failures: number;
  }>;
  project_summary: Array<{
    label: string;
    evidence_count: number;
    last_seen: string;
  }>;
  timeline: Array<{
    source_type: string;
    artifact_type: string;
    observed_at: string;
    session_log_available: boolean;
    validation_signal_present: boolean;
    outcome: EvidenceOutcomeLabel;
  }>;
  trend_windows: {
    "7d": PortalRates;
    "30d": PortalRates;
  };
};

/**
 * Agent profile by full 64-hex commitment hash; null if unknown.
 */
export async function getAgentProfile(
  agentCommitmentHash: string
): Promise<AgentProfile | null> {
  const enrollment_status = await resolveEnrollmentStatus(agentCommitmentHash);
  const presentation =
    enrollment_status === "ENROLLED"
      ? await getPresentation(agentCommitmentHash)
      : null;

  const events = await prisma.agentEvidence.findMany({
    where: { agentIdentityCommitment: agentCommitmentHash },
    select: EVIDENCE_SELECT,
    orderBy: { observedAt: "desc" },
  });

  if (events.length === 0) {
    if (enrollment_status !== "ENROLLED") {
      return null;
    }

    return {
      agent_commitment_hash: agentCommitmentHash,
      enrollment_status: "ENROLLED_NO_EVIDENCE",
      presentation,
      first_observed_at: null,
      last_observed_at: null,
      totals: {
        evidence_count: 0,
        artifact_count: 0,
        correction_count: 0,
        failure_count: 0,
      },
      distributions: {
        normalized_event_type: {},
        error_tranche: {},
      },
      source_breakdown: [],
      project_summary: [],
      timeline: [],
      trend_windows: {
        "7d": computeRates([]),
        "30d": computeRates([]),
      },
    };
  }

  const since30d = windowStart(30);
  const since7d = windowStart(7);
  const events30d = events.filter((e) => e.observedAt >= since30d);
  const events7d = events.filter((e) => e.observedAt >= since7d);

  const normalizedEventType: Record<string, number> = {};
  // Portal alias for ingestion field rawErrorClassification.
  const errorTranche: Record<string, number> = {};

  for (const e of events) {
    normalizedEventType[e.normalizedEventType] =
      (normalizedEventType[e.normalizedEventType] ?? 0) + 1;
    if (e.rawErrorClassification != null) {
      errorTranche[e.rawErrorClassification] =
        (errorTranche[e.rawErrorClassification] ?? 0) + 1;
    }
  }

  const sortedAsc = [...events].sort(
    (a, b) => a.observedAt.getTime() - b.observedAt.getTime()
  );

  // ── Source breakdown ──
  const sourceMap = new Map<string, { count: number; artifacts: number; successes: number; failures: number }>();
  for (const e of events) {
    let entry = sourceMap.get(e.sourceType);
    if (!entry) {
      entry = { count: 0, artifacts: 0, successes: 0, failures: 0 };
      sourceMap.set(e.sourceType, entry);
    }
    entry.count++;
    if (e.normalizedEventType === "AGENT_ARTIFACT_CREATED") entry.artifacts++;
    if (e.normalizedEventType === "EXECUTION_FAILURE_OBSERVED") entry.failures++;
    if (e.normalizedEventType === "VALIDATION_OBSERVED" || e.normalizedEventType === "AGENT_ARTIFACT_CREATED") entry.successes++;
  }
  const source_breakdown = Array.from(sourceMap.entries())
    .map(([source_type, stats]) => ({ source_type, ...stats }))
    .sort((a, b) => b.count - a.count);

  // ── Project/repo summary ──
  const projectMap = new Map<string, { evidence_count: number; last_seen: Date }>();
  for (const e of events) {
    const projectLabel =
      e.externalTaskId ? `task:${e.externalTaskId}` :
      e.commitSha ? `commit:${e.commitSha.slice(0, 12)}` :
      e.repositoryCommitment ? `repo:${e.repositoryCommitment.slice(0, 12)}` :
      e.sourceUrl ? `url:${new URL(e.sourceUrl).hostname}` :
      e.sourceType;
    const existing = projectMap.get(projectLabel);
    if (existing) {
      existing.evidence_count++;
      if (e.observedAt > existing.last_seen) existing.last_seen = e.observedAt;
    } else {
      projectMap.set(projectLabel, { evidence_count: 1, last_seen: e.observedAt });
    }
  }
  const project_summary = Array.from(projectMap.entries())
    .map(([label, stats]) => ({ label, ...stats, last_seen: stats.last_seen.toISOString() }))
    .sort((a, b) => b.evidence_count - a.evidence_count)
    .slice(0, 10);

  return {
    agent_commitment_hash: agentCommitmentHash,
    enrollment_status,
    presentation,
    first_observed_at: sortedAsc[0].observedAt.toISOString(),
    last_observed_at: sortedAsc[sortedAsc.length - 1].observedAt.toISOString(),
    totals: {
      evidence_count: events.length,
      artifact_count: events.filter(
        (e) => e.normalizedEventType === "AGENT_ARTIFACT_CREATED"
      ).length,
      correction_count: events.filter(
        (e) => e.normalizedEventType === "HUMAN_CORRECTION_OBSERVED"
      ).length,
      failure_count: events.filter(
        (e) => e.normalizedEventType === "EXECUTION_FAILURE_OBSERVED"
      ).length,
    },
    distributions: {
      normalized_event_type: normalizedEventType,
      error_tranche: errorTranche,
    },
    source_breakdown,
    project_summary,
    timeline: events.slice(0, 50).map((e) => ({
      source_type: e.sourceType,
      artifact_type: e.artifactType,
      observed_at: e.observedAt.toISOString(),
      session_log_available: e.sessionLogUrlCommitment != null,
      validation_signal_present: e.validationSignalPresent,
      outcome: evidenceOutcomeLabel(e.normalizedEventType),
    })),
    trend_windows: {
      "7d": computeRates(events7d),
      "30d": computeRates(events30d),
    },
  };
}

/** Field names withheld from the public manifest (values never exposed). */
const MANIFEST_MASKED_FIELDS = [
  "input_digest",
  "output_hash",
  "refusal_reason",
  "terminal_reason",
  "operator_id",
  "agent_id",
  "authority_scope",
  "domain",
  "domain_commitment",
  "blind_salt",
] as const;

export type InclusionPathEntry = {
  receipt_id: string;
  commitment_hash: string;
  previous_hash: string | null;
};

export type ReceiptPublicManifest = {
  receipt_id: string;
  record_type: string;
  commitment_hash: string;
  previous_hash: string | null;
  parent_hash: null;
  observed_at: string;
  verification_status: "verified" | "failed" | null;
  signature: string | null;
  masked_fields: readonly string[];
  proof_chain_available: boolean;
  inclusion_path: InclusionPathEntry[] | null;
  enforcement_state: string | null;
  linked_liability_event_id: string | null;
};

type ReceiptChainRow = {
  receiptId: string;
  contentHash: string;
  prevReceiptHash: string | null;
  issuedAt: Date;
};

/**
 * Builds genesis-to-target inclusion path from receipt history.
 */
function buildInclusionPath(
  receipt: ReceiptChainRow,
  history: ReceiptChainRow[],
  proofChainAvailable: boolean
): InclusionPathEntry[] | null {
  if (!proofChainAvailable) {
    return null;
  }

  const all = [...history];
  if (!all.some((h) => h.receiptId === receipt.receiptId)) {
    all.push(receipt);
  }
  all.sort((a, b) => a.issuedAt.getTime() - b.issuedAt.getTime());

  return all.map((r) => ({
    receipt_id: r.receiptId,
    commitment_hash: r.contentHash,
    previous_hash: r.prevReceiptHash,
  }));
}

/**
 * Public receipt manifest with real verifyReceipt verification (not signature presence alone).
 */
export async function getReceiptPublicManifest(
  receiptId: string
): Promise<ReceiptPublicManifest | null> {
  const data = await getReceiptWithHistory(receiptId);
  if (!data) {
    return null;
  }

  const { receipt } = data;
  const payload = dbReceiptToPayload({
    ...receipt,
    operatorId: operatorIdFromStripe(receipt.operator.stripeCustomerId),
  });

  let verification_status: "verified" | "failed" | null = null;
  if (payload.signature) {
    try {
      const result = await verifyReceipt(payload);
      verification_status = result.valid ? "verified" : "failed";
    } catch {
      verification_status = null;
    }
  }

  const proof_chain_available =
    receipt.prevReceiptHash != null && receipt.signature != null;

  const bridge = await prisma.evidenceReceiptLink.findFirst({
    where: { receiptId },
    select: {
      enforcementState: true,
      liabilityEventId: true,
    },
  });

  const inclusion_path = buildInclusionPath(
    {
      receiptId: receipt.receiptId,
      contentHash: receipt.contentHash,
      prevReceiptHash: receipt.prevReceiptHash,
      issuedAt: receipt.issuedAt,
    },
    data.history.map((h) => ({
      receiptId: h.receiptId,
      contentHash: h.contentHash,
      prevReceiptHash: h.prevReceiptHash,
      issuedAt: h.issuedAt,
    })),
    proof_chain_available
  );

  return {
    receipt_id: receipt.receiptId,
    record_type: receipt.status,
    commitment_hash: receipt.contentHash,
    previous_hash: receipt.prevReceiptHash,
    parent_hash: null,
    observed_at: receipt.issuedAt.toISOString(),
    verification_status,
    signature: receipt.signature,
    masked_fields: [...MANIFEST_MASKED_FIELDS],
    proof_chain_available,
    inclusion_path,
    enforcement_state: bridge?.enforcementState ?? null,
    linked_liability_event_id: bridge?.liabilityEventId ?? null,
  };
}

/** Validates full 64-hex agent commitment hash. */
export function isValidAgentCommitmentHash(hash: string): boolean {
  return /^[0-9a-f]{64}$/i.test(hash);
}

/**
 * Parses and validates leaderboard limit query param.
 */
export function parseLeaderboardLimit(
  raw: string | null
): { ok: true; limit: number } | { ok: false } {
  if (raw == null || raw === "") {
    return { ok: true, limit: 20 };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    return { ok: false };
  }
  return { ok: true, limit: Math.min(n, 100) };
}
