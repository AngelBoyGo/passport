import { z } from "zod";
import { sha256Hex, canonicalJson } from "@/lib/receipt/canonical";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Taxonomy (TS unions — not Prisma enums)
// ---------------------------------------------------------------------------

export type SourceType =
  | "github_push_webhook"
  | "github_commit_payload"
  | "github_issue_event"
  | "compliance_report"
  | "otel_genai_trace"
  | "task_deliverable";

export type NormalizedEventType =
  | "AGENT_RUN_OBSERVED"
  | "AGENT_ARTIFACT_CREATED"
  | "HUMAN_CORRECTION_OBSERVED"
  | "VALIDATION_OBSERVED"
  | "EXECUTION_FAILURE_OBSERVED";

export type RawErrorClassification =
  | "LOGIC_DETECTION"
  | "COMPUTE_TIMEOUT"
  | "UNKNOWN";

export type ArtifactType =
  | "commit"
  | "pull_request"
  | "trace"
  | "webhook_event"
  | "issue"
  | "issue_label"
  | "compliance_report"
  | "task_deliverable";

export interface NormalizedEvidence {
  source_type: SourceType;
  source_url: string | null;
  observed_at: Date;
  agent_identity_raw: string | null;
  repository_raw: string | null;
  commit_sha: string | null;
  branch_name: string | null;
  session_log_url: string | null;
  execution_started_at: Date | null;
  execution_finished_at: Date | null;
  token_usage_input: number | null;
  token_usage_output: number | null;
  tool_call_count: number | null;
  validation_signal_present: boolean;
  artifact_type: ArtifactType;
  raw_error_classification: RawErrorClassification | null;
  normalized_event_type: NormalizedEventType;
  /** In-memory dedup key when commit_sha is absent; not persisted. */
  artifact_identifier: string | null;
}

export interface MaskedAgentEvidence {
  sourceType: SourceType;
  artifactType: ArtifactType;
  normalizedEventType: NormalizedEventType;
  rawErrorClassification: RawErrorClassification | null;
  observedAt: Date;
  agentIdentityCommitment: string;
  repositoryCommitment: string | null;
  branchCommitment: string | null;
  commitSha: string | null;
  sessionLogUrlCommitment: string | null;
  sourceUrl: string | null;
  executionStartedAt: Date | null;
  executionFinishedAt: Date | null;
  tokenUsageInput: number | null;
  tokenUsageOutput: number | null;
  toolCallCount: number | null;
  validationSignalPresent: boolean;
  eventCommitmentHash: string;
  sourceDigest: string | null;
}

// ---------------------------------------------------------------------------
// Zod schemas (permissive — unknown vendor fields never throw)
// ---------------------------------------------------------------------------

const AuthorSchema = z
  .object({
    name: z.string().optional(),
    email: z.string().optional(),
  })
  .passthrough();

const CommitEntrySchema = z
  .object({
    id: z.string().optional(),
    sha: z.string().optional(),
    message: z.string().optional(),
    url: z.string().optional(),
    author: AuthorSchema.optional(),
    timestamp: z.string().optional(),
    validation_status: z.string().optional(),
    check_status: z.string().optional(),
  })
  .passthrough();

export const GithubCommitWebhookSchema = z
  .object({
    ref: z.string().optional(),
    repository: z
      .object({
        full_name: z.string().optional(),
        html_url: z.string().optional(),
      })
      .passthrough()
      .optional(),
    head_commit: CommitEntrySchema.optional(),
    commits: z.array(CommitEntrySchema).optional(),
  })
  .passthrough();

export const GithubSingleCommitSchema = z
  .object({
    sha: z.string().optional(),
    html_url: z.string().optional(),
    commit: z
      .object({
        message: z.string().optional(),
        author: AuthorSchema.optional(),
        committer: AuthorSchema.optional(),
      })
      .passthrough()
      .optional(),
    validation_status: z.string().optional(),
    check_status: z.string().optional(),
  })
  .passthrough();

export const GenAiTraceSchema = z
  .object({
    name: z.string().optional(),
    attributes: z.record(z.unknown()).optional(),
    status: z
      .object({
        code: z.string().optional(),
        message: z.string().optional(),
      })
      .passthrough()
      .optional(),
    startTimeUnixNano: z.string().optional(),
    endTimeUnixNano: z.string().optional(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
  })
  .passthrough();

export const IssueTriagePayloadSchema = z
  .object({
    agent_identity: z.string().optional(),
    repository: z.string().optional(),
    issue: z
      .object({
        id: z.string().optional(),
        number: z.number().optional(),
        url: z.string().optional(),
        title: z.string().optional(),
      })
      .passthrough()
      .optional(),
    labels: z.array(z.string()).optional(),
    action: z.string().optional(),
    summary: z.string().optional(),
    transcript_url: z.string().optional(),
    observed_at: z.string().optional(),
  })
  .passthrough();

export const ComplianceReportPayloadSchema = z
  .object({
    agent_identity: z.string().optional(),
    control_domain: z.string().optional(),
    report: z
      .object({
        id: z.string().optional(),
        url: z.string().optional(),
        title: z.string().optional(),
      })
      .passthrough()
      .optional(),
    action: z.string().optional(),
    transcript_url: z.string().optional(),
    observed_at: z.string().optional(),
  })
  .passthrough();

export const TaskDeliverablePayloadSchema = z
  .object({
    task_id: z.string().min(1),
    digest: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, "digest must be a 64-character hex string"),
    observed_at: z.string().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Salt / commitment helpers
// ---------------------------------------------------------------------------

const TEST_SALT = "vitest-ingestion-commitment-salt";

function resolveSalt(): string {
  if (
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    typeof (globalThis as { __vitest_index__?: unknown }).__vitest_index__ !==
      "undefined"
  ) {
    return process.env.INGESTION_COMMITMENT_SALT ?? TEST_SALT;
  }
  const salt = process.env.INGESTION_COMMITMENT_SALT;
  if (!salt) {
    throw new Error(
      "INGESTION_COMMITMENT_SALT is required outside test environments"
    );
  }
  return salt;
}

/**
 * Salted SHA-256 commitment for privacy-preserving identifiers.
 */
export function commit(value: string): string {
  return sha256Hex(value + resolveSalt());
}

function normalizeTimestampForHash(value: Date | null | undefined): string {
  if (value == null) return "";
  const ms = value.getTime();
  if (!Number.isFinite(ms)) return "";
  return String(ms);
}

/**
 * Stable semantic dedup key — timestamp-normalized so partial/malformed times
 * never produce divergent hashes across replays.
 */
export function eventCommitmentHash(n: NormalizedEvidence): string {
  const dedupKey =
    n.commit_sha ??
    n.artifact_identifier ??
    n.source_url ??
    "";
  const parts = [
    n.source_type,
    dedupKey,
    n.normalized_event_type,
    normalizeTimestampForHash(n.execution_started_at),
  ];
  return commit(parts.join("|"));
}

/**
 * Raw payload fingerprint for replay vs semantic-event triage.
 */
export function sourceDigest(rawPayload: unknown): string {
  if (rawPayload === null || typeof rawPayload !== "object") {
    return sha256Hex(String(rawPayload));
  }
  return sha256Hex(canonicalJson(rawPayload as Record<string, unknown>));
}

/**
 * Maps internal normalized evidence to the masked persistence shape.
 */
export function toMaskedEvidence(n: NormalizedEvidence): MaskedAgentEvidence {
  return {
    sourceType: n.source_type,
    artifactType: n.artifact_type,
    normalizedEventType: n.normalized_event_type,
    rawErrorClassification: n.raw_error_classification,
    observedAt: n.observed_at,
    agentIdentityCommitment: commit(n.agent_identity_raw ?? ""),
    repositoryCommitment: n.repository_raw ? commit(n.repository_raw) : null,
    branchCommitment: n.branch_name ? commit(n.branch_name) : null,
    commitSha: n.commit_sha,
    sessionLogUrlCommitment: n.session_log_url
      ? commit(n.session_log_url)
      : null,
    sourceUrl: n.source_url,
    executionStartedAt: n.execution_started_at,
    executionFinishedAt: n.execution_finished_at,
    tokenUsageInput: n.token_usage_input,
    tokenUsageOutput: n.token_usage_output,
    toolCallCount: n.tool_call_count,
    validationSignalPresent: n.validation_signal_present,
    eventCommitmentHash: eventCommitmentHash(n),
    sourceDigest: null,
  };
}

// ---------------------------------------------------------------------------
// GitHub parsing helpers
// ---------------------------------------------------------------------------

const AGENT_LOGS_URL_RE = /^Agent-Logs-Url:\s*(.+)$/gim;

/**
 * Parses Agent-Logs-Url commit trailers. Last occurrence wins (app-level
 * convention — not full git interpret-trailers semantics).
 */
export function parseAgentLogsUrl(message: string | undefined): string | null {
  if (!message) return null;
  let last: string | null = null;
  for (const match of message.matchAll(AGENT_LOGS_URL_RE)) {
    const url = match[1]?.trim();
    if (url) last = url;
  }
  return last;
}

const HUMAN_CORRECTION_RE =
  /\b(revert|reverts commit|superseded|override)\b/i;

function detectHumanCorrection(message: string | undefined): boolean {
  return HUMAN_CORRECTION_RE.test(message ?? "");
}

const VALIDATION_KEYWORD_RE =
  /\b(tests?\s+pass|ci\s+green|all\s+tests\s+pass)\b/i;

function hasExplicitValidationMarker(
  entry: z.infer<typeof CommitEntrySchema>
): boolean {
  const status = entry.validation_status ?? entry.check_status;
  if (typeof status === "string" && status.trim().length > 0) {
    return true;
  }
  return false;
}

function resolveCommitSha(entry: z.infer<typeof CommitEntrySchema>): string | null {
  return entry.sha ?? entry.id ?? null;
}

function resolveBranch(ref: string | undefined): string | null {
  if (!ref) return null;
  const prefix = "refs/heads/";
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
}

function parseIsoDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function resolveAgentFromAuthor(
  author: z.infer<typeof AuthorSchema> | undefined
): string | null {
  if (!author) return null;
  if (author.name?.trim()) return author.name.trim();
  if (author.email?.trim()) return author.email.trim();
  return null;
}

function mapGithubCommitEntry(
  entry: z.infer<typeof CommitEntrySchema>,
  ctx: {
    sourceType: SourceType;
    repositoryRaw: string | null;
    branchName: string | null;
    repoUrl: string | null;
  }
): NormalizedEvidence {
  const message = entry.message ?? "";
  const humanCorrection = detectHumanCorrection(message);
  const explicitValidation = hasExplicitValidationMarker(entry);
  const hasKeywordHint = VALIDATION_KEYWORD_RE.test(message);

  let normalized_event_type: NormalizedEventType = "AGENT_ARTIFACT_CREATED";
  let raw_error_classification: RawErrorClassification = "UNKNOWN";
  let validation_signal_present = false;

  if (humanCorrection) {
    normalized_event_type = "HUMAN_CORRECTION_OBSERVED";
    raw_error_classification = "LOGIC_DETECTION";
  } else if (explicitValidation) {
    normalized_event_type = "VALIDATION_OBSERVED";
    validation_signal_present = true;
  } else if (hasKeywordHint) {
    normalized_event_type = "VALIDATION_OBSERVED";
    validation_signal_present = false;
  }

  return {
    source_type: ctx.sourceType,
    source_url: entry.url ?? ctx.repoUrl,
    observed_at: parseIsoDate(entry.timestamp) ?? new Date(0),
    agent_identity_raw: resolveAgentFromAuthor(entry.author),
    repository_raw: ctx.repositoryRaw,
    commit_sha: resolveCommitSha(entry),
    branch_name: ctx.branchName,
    session_log_url: parseAgentLogsUrl(message),
    execution_started_at: null,
    execution_finished_at: null,
    token_usage_input: null,
    token_usage_output: null,
    tool_call_count: null,
    validation_signal_present,
    artifact_type: "commit",
    raw_error_classification,
    normalized_event_type,
    artifact_identifier: null,
  };
}

/**
 * Normalizes GitHub push webhook or single-commit payloads into evidence records.
 * When commits[] is present it is authoritative (one record per entry); otherwise
 * falls back to head_commit alone.
 */
export function normalizeGithubEvidence(
  payload: unknown,
  sourceType: "github_push_webhook" | "github_commit_payload" = "github_push_webhook"
): NormalizedEvidence[] {
  if (sourceType === "github_commit_payload") {
    const parsed = GithubSingleCommitSchema.safeParse(payload);
    if (!parsed.success) return [];

    const data = parsed.data;
    const entry: z.infer<typeof CommitEntrySchema> = {
      sha: data.sha,
      message: data.commit?.message,
      url: data.html_url,
      author: data.commit?.author ?? data.commit?.committer,
      validation_status: data.validation_status,
      check_status: data.check_status,
    };

    return [
      mapGithubCommitEntry(entry, {
        sourceType: "github_commit_payload",
        repositoryRaw: null,
        branchName: null,
        repoUrl: data.html_url ?? null,
      }),
    ];
  }

  const parsed = GithubCommitWebhookSchema.safeParse(payload);
  if (!parsed.success) return [];

  const data = parsed.data;
  const repositoryRaw = data.repository?.full_name ?? null;
  const repoUrl = data.repository?.html_url ?? null;
  const branchName = resolveBranch(data.ref);

  const commitEntries =
    data.commits && data.commits.length > 0
      ? data.commits
      : data.head_commit
        ? [data.head_commit]
        : [];

  return commitEntries.map((entry) =>
    mapGithubCommitEntry(entry, {
      sourceType: "github_push_webhook",
      repositoryRaw,
      branchName,
      repoUrl,
    })
  );
}

// ---------------------------------------------------------------------------
// OTel GenAI trace normalization
// ---------------------------------------------------------------------------

function readNumericAttr(
  attrs: Record<string, unknown>,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const v = attrs[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function readStringAttr(
  attrs: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const v = attrs[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

function classifyTraceError(
  message: string | undefined
): RawErrorClassification {
  const text = (message ?? "").toLowerCase();
  if (
    /(timeout|timed out|deadline|token.*overflow|token.*exhaust|context.*length|transport.*disconnect|\b429\b|quota)/.test(
      text
    )
  ) {
    return "COMPUTE_TIMEOUT";
  }
  if (text.length > 0) {
    return "LOGIC_DETECTION";
  }
  return "UNKNOWN";
}

function parseUnixNano(value: string | undefined): Date | null {
  if (!value) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const ms = Math.floor(num / 1_000_000);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * Normalizes OTel-style GenAI agent traces. Only invoke_agent operations are
 * in scope; other operations are ignored.
 */
export function normalizeGenAiTrace(payload: unknown): NormalizedEvidence[] {
  const parsed = GenAiTraceSchema.safeParse(payload);
  if (!parsed.success) return [];

  const span = parsed.data;
  const attrs = span.attributes ?? {};
  const operation =
    readStringAttr(attrs, "gen_ai.operation.name") ??
    (span.name === "invoke_agent" ? "invoke_agent" : null);

  if (operation !== "invoke_agent") return [];

  const agentIdentity =
    readStringAttr(attrs, "gen_ai.agent.id", "gen_ai.agent.name", "agent.id") ??
    null;

  const statusCode = (span.status?.code ?? "UNSET").toString().toUpperCase();
  const tokenInput = readNumericAttr(
    attrs,
    "gen_ai.usage.input_tokens",
    "gen_ai.usage.prompt_tokens"
  );
  const tokenOutput = readNumericAttr(
    attrs,
    "gen_ai.usage.output_tokens",
    "gen_ai.usage.completion_tokens"
  );
  const toolCallCount = readNumericAttr(
    attrs,
    "tool.call.count",
    "gen_ai.tool.call.count",
    "tool_call_count"
  );

  const startedAt =
    parseUnixNano(span.startTimeUnixNano) ??
    parseIsoDate(span.start_time ?? undefined);
  const finishedAt =
    parseUnixNano(span.endTimeUnixNano) ??
    parseIsoDate(span.end_time ?? undefined);

  const explicitValidation =
    readStringAttr(attrs, "validation.status", "check.status") !== null;

  let normalized_event_type: NormalizedEventType = "AGENT_RUN_OBSERVED";
  let raw_error_classification: RawErrorClassification | null = "UNKNOWN";
  let validation_signal_present = explicitValidation;

  if (statusCode === "ERROR") {
    normalized_event_type = "EXECUTION_FAILURE_OBSERVED";
    raw_error_classification = classifyTraceError(span.status?.message);
  } else if (explicitValidation) {
    normalized_event_type = "VALIDATION_OBSERVED";
  }

  return [
    {
      source_type: "otel_genai_trace",
      source_url: null,
      observed_at: startedAt ?? finishedAt ?? new Date(0),
      agent_identity_raw: agentIdentity,
      repository_raw: null,
      commit_sha: null,
      branch_name: null,
      session_log_url: null,
      execution_started_at: startedAt,
      execution_finished_at: finishedAt,
      token_usage_input: tokenInput,
      token_usage_output: tokenOutput,
      tool_call_count: toolCallCount,
      validation_signal_present,
      artifact_type: "trace",
      raw_error_classification,
      normalized_event_type,
      artifact_identifier: null,
    },
  ];
}

// ---------------------------------------------------------------------------
// Reference-agent issue triage + compliance normalization
// ---------------------------------------------------------------------------

function resolveIssueArtifactId(
  issue: z.infer<typeof IssueTriagePayloadSchema>["issue"]
): string | null {
  if (!issue) return null;
  if (issue.id?.trim()) return issue.id.trim();
  if (issue.number != null) return `issue-${issue.number}`;
  return null;
}

function mapIssueTriageAction(action: string | undefined): {
  normalized_event_type: NormalizedEventType;
  validation_signal_present: boolean;
  raw_error_classification: RawErrorClassification | null;
} {
  const normalized = (action ?? "triage_output").toLowerCase();
  if (normalized === "override" || normalized === "revert") {
    return {
      normalized_event_type: "HUMAN_CORRECTION_OBSERVED",
      validation_signal_present: false,
      raw_error_classification: "LOGIC_DETECTION",
    };
  }
  if (normalized === "accept") {
    return {
      normalized_event_type: "AGENT_ARTIFACT_CREATED",
      validation_signal_present: true,
      raw_error_classification: "UNKNOWN",
    };
  }
  return {
    normalized_event_type: "AGENT_ARTIFACT_CREATED",
    validation_signal_present: false,
    raw_error_classification: "UNKNOWN",
  };
}

/**
 * Normalizes issue-triage agent payloads into evidence records.
 */
export function normalizeIssueTriageEvidence(
  payload: unknown
): NormalizedEvidence[] {
  const parsed = IssueTriagePayloadSchema.safeParse(payload);
  if (!parsed.success) return [];

  const data = parsed.data;
  const artifactId = resolveIssueArtifactId(data.issue);
  if (!artifactId) return [];

  const hasLabels = (data.labels?.length ?? 0) > 0;
  const eventMapping = mapIssueTriageAction(data.action);

  return [
    {
      source_type: "github_issue_event",
      source_url: data.issue?.url ?? null,
      observed_at: parseIsoDate(data.observed_at ?? undefined) ?? new Date(0),
      agent_identity_raw: data.agent_identity?.trim() ?? null,
      repository_raw: data.repository?.trim() ?? null,
      commit_sha: null,
      branch_name: null,
      session_log_url: data.transcript_url?.trim() ?? null,
      execution_started_at: null,
      execution_finished_at: null,
      token_usage_input: null,
      token_usage_output: null,
      tool_call_count: null,
      validation_signal_present: eventMapping.validation_signal_present,
      artifact_type: hasLabels ? "issue_label" : "issue",
      raw_error_classification: eventMapping.raw_error_classification,
      normalized_event_type: eventMapping.normalized_event_type,
      artifact_identifier: artifactId,
    },
  ];
}

function mapComplianceAction(action: string | undefined): {
  normalized_event_type: NormalizedEventType;
  validation_signal_present: boolean;
  raw_error_classification: RawErrorClassification | null;
} {
  const normalized = (action ?? "report_created").toLowerCase();
  if (normalized === "rejected") {
    return {
      normalized_event_type: "HUMAN_CORRECTION_OBSERVED",
      validation_signal_present: false,
      raw_error_classification: "LOGIC_DETECTION",
    };
  }
  if (normalized === "approved") {
    return {
      normalized_event_type: "AGENT_ARTIFACT_CREATED",
      validation_signal_present: true,
      raw_error_classification: "UNKNOWN",
    };
  }
  return {
    normalized_event_type: "AGENT_ARTIFACT_CREATED",
    validation_signal_present: false,
    raw_error_classification: "UNKNOWN",
  };
}

/**
 * Normalizes HostHub task deliverable payloads into evidence records.
 */
export function normalizeTaskDeliverableEvidence(
  payload: unknown
): NormalizedEvidence[] {
  const parsed = TaskDeliverablePayloadSchema.safeParse(payload);
  if (!parsed.success) return [];

  const data = parsed.data;
  const taskId = data.task_id.trim();

  return [
    {
      source_type: "task_deliverable",
      source_url: null,
      observed_at: parseIsoDate(data.observed_at ?? undefined) ?? new Date(0),
      agent_identity_raw: null,
      repository_raw: null,
      commit_sha: data.digest.toLowerCase(),
      branch_name: null,
      session_log_url: null,
      execution_started_at: null,
      execution_finished_at: null,
      token_usage_input: null,
      token_usage_output: null,
      tool_call_count: null,
      validation_signal_present: true,
      artifact_type: "task_deliverable",
      raw_error_classification: "UNKNOWN",
      normalized_event_type: "AGENT_ARTIFACT_CREATED",
      artifact_identifier: taskId,
    },
  ];
}

/**
 * Normalizes compliance-evidence agent report payloads into evidence records.
 */
export function normalizeComplianceEvidence(
  payload: unknown
): NormalizedEvidence[] {
  const parsed = ComplianceReportPayloadSchema.safeParse(payload);
  if (!parsed.success) return [];

  const data = parsed.data;
  const reportId = data.report?.id?.trim();
  if (!reportId) return [];

  const eventMapping = mapComplianceAction(data.action);

  return [
    {
      source_type: "compliance_report",
      source_url: data.report?.url ?? null,
      observed_at: parseIsoDate(data.observed_at ?? undefined) ?? new Date(0),
      agent_identity_raw: data.agent_identity?.trim() ?? null,
      repository_raw: data.control_domain?.trim() ?? null,
      commit_sha: null,
      branch_name: null,
      session_log_url: data.transcript_url?.trim() ?? null,
      execution_started_at: null,
      execution_finished_at: null,
      token_usage_input: null,
      token_usage_output: null,
      tool_call_count: null,
      validation_signal_present: eventMapping.validation_signal_present,
      artifact_type: "compliance_report",
      raw_error_classification: eventMapping.raw_error_classification,
      normalized_event_type: eventMapping.normalized_event_type,
      artifact_identifier: reportId,
    },
  ];
}

export interface NormalizeEvidenceInput {
  sourceType: SourceType;
  payload: unknown;
}

/**
 * Dispatches normalization by narrow source_type.
 */
export function normalizeEvidence(input: NormalizeEvidenceInput): NormalizedEvidence[] {
  switch (input.sourceType) {
    case "github_push_webhook":
      return normalizeGithubEvidence(input.payload, "github_push_webhook");
    case "github_commit_payload":
      return normalizeGithubEvidence(input.payload, "github_commit_payload");
    case "otel_genai_trace":
      return normalizeGenAiTrace(input.payload);
    case "github_issue_event":
      return normalizeIssueTriageEvidence(input.payload);
    case "compliance_report":
      return normalizeComplianceEvidence(input.payload);
    case "task_deliverable":
      return normalizeTaskDeliverableEvidence(input.payload);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Persistence (idempotent upsert on eventCommitmentHash)
// ---------------------------------------------------------------------------

/**
 * Persists masked evidence records. Replays with the same eventCommitmentHash
 * are no-ops (update: {}).
 */
export async function persistEvidence(
  records: MaskedAgentEvidence[]
): Promise<void> {
  for (const record of records) {
    await prisma.agentEvidence.upsert({
      where: { eventCommitmentHash: record.eventCommitmentHash },
      create: {
        sourceType: record.sourceType,
        artifactType: record.artifactType,
        normalizedEventType: record.normalizedEventType,
        rawErrorClassification: record.rawErrorClassification,
        observedAt: record.observedAt,
        agentIdentityCommitment: record.agentIdentityCommitment,
        repositoryCommitment: record.repositoryCommitment,
        branchCommitment: record.branchCommitment,
        commitSha: record.commitSha,
        sessionLogUrlCommitment: record.sessionLogUrlCommitment,
        sourceUrl: record.sourceUrl,
        executionStartedAt: record.executionStartedAt,
        executionFinishedAt: record.executionFinishedAt,
        tokenUsageInput: record.tokenUsageInput,
        tokenUsageOutput: record.tokenUsageOutput,
        toolCallCount: record.toolCallCount,
        validationSignalPresent: record.validationSignalPresent,
        eventCommitmentHash: record.eventCommitmentHash,
        sourceDigest: record.sourceDigest,
      },
      update: {},
    });
  }
}
