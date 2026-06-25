import { describe, it, expect, vi, beforeEach } from "vitest";

const { agentEvidenceUpsertMock } = vi.hoisted(() => ({
  agentEvidenceUpsertMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    agentEvidence: {
      upsert: agentEvidenceUpsertMock,
    },
  },
}));

import {
  normalizeGithubEvidence,
  normalizeGenAiTrace,
  normalizeEvidence,
  toMaskedEvidence,
  eventCommitmentHash,
  sourceDigest,
  commit,
  persistEvidence,
  type NormalizedEvidence,
} from "@/lib/ingestion/github-agent-adapter";

const TEST_SALT = "vitest-ingestion-commitment-salt";

beforeEach(() => {
  vi.clearAllMocks();
  agentEvidenceUpsertMock.mockResolvedValue({});
  process.env.INGESTION_COMMITMENT_SALT = TEST_SALT;
});

function baseGithubPush(overrides: Record<string, unknown> = {}) {
  return {
    ref: "refs/heads/main",
    repository: {
      full_name: "acme/agent-repo",
      html_url: "https://github.com/acme/agent-repo",
    },
    head_commit: {
      id: "abc111",
      sha: "abc111",
      message: "feat: agent-generated patch\n\nAgent-Logs-Url: https://logs.example.com/sess-1",
      url: "https://github.com/acme/agent-repo/commit/abc111",
      author: { name: "cursor-agent", email: "agent@bots.local" },
      timestamp: "2026-06-15T12:00:00Z",
    },
    commits: [
      {
        id: "abc111",
        sha: "abc111",
        message:
          "feat: agent-generated patch\n\nAgent-Logs-Url: https://logs.example.com/sess-1",
        url: "https://github.com/acme/agent-repo/commit/abc111",
        author: { name: "cursor-agent", email: "agent@bots.local" },
        timestamp: "2026-06-15T12:00:00Z",
      },
    ],
    ...overrides,
  };
}

describe("normalizeGithubEvidence", () => {
  it("extracts Agent-Logs-Url trailer (last occurrence wins) and maps AGENT_ARTIFACT_CREATED", () => {
    const payload = baseGithubPush({
      head_commit: {
        id: "abc111",
        message:
          "Agent-Logs-Url: https://old.example.com\n\nfix\n\nAgent-Logs-Url: https://logs.example.com/sess-final",
        url: "https://github.com/acme/agent-repo/commit/abc111",
        author: { name: "bot", email: "b@local" },
        timestamp: "2026-06-15T12:00:00Z",
      },
      commits: [
        {
          id: "abc111",
          message:
            "Agent-Logs-Url: https://old.example.com\n\nfix\n\nAgent-Logs-Url: https://logs.example.com/sess-final",
          url: "https://github.com/acme/agent-repo/commit/abc111",
          author: { name: "bot", email: "b@local" },
          timestamp: "2026-06-15T12:00:00Z",
        },
      ],
    });

    const records = normalizeGithubEvidence(payload, "github_push_webhook");
    expect(records).toHaveLength(1);
    expect(records[0].session_log_url).toBe("https://logs.example.com/sess-final");
    expect(records[0].normalized_event_type).toBe("AGENT_ARTIFACT_CREATED");
    expect(records[0].source_type).toBe("github_push_webhook");
    expect(records[0].artifact_type).toBe("commit");
  });

  it("normalizes commit payload without Agent-Logs-Url trailer with null session_log_url", () => {
    const payload = {
      sha: "def222",
      commit: {
        message: "chore: routine update",
        author: { name: "human", email: "h@local" },
      },
      html_url: "https://github.com/acme/agent-repo/commit/def222",
    };

    const records = normalizeGithubEvidence(payload, "github_commit_payload");
    expect(records).toHaveLength(1);
    expect(records[0].session_log_url).toBeNull();
    expect(records[0].commit_sha).toBe("def222");
    expect(records[0].normalized_event_type).toBe("AGENT_ARTIFACT_CREATED");
    expect(records[0].source_type).toBe("github_commit_payload");
  });

  it("uses commits[] as authoritative when present (one record per commit, not head_commit duplicate)", () => {
    const payload = baseGithubPush({
      head_commit: {
        id: "head999",
        message: "head-only message should not duplicate",
        url: "https://github.com/acme/agent-repo/commit/head999",
        author: { name: "head-bot", email: "h@local" },
        timestamp: "2026-06-15T13:00:00Z",
      },
      commits: [
        {
          id: "aaa111",
          message: "first pushed commit",
          url: "https://github.com/acme/agent-repo/commit/aaa111",
          author: { name: "bot-a", email: "a@local" },
          timestamp: "2026-06-15T12:00:00Z",
        },
        {
          id: "bbb222",
          message: "second pushed commit",
          url: "https://github.com/acme/agent-repo/commit/bbb222",
          author: { name: "bot-b", email: "b@local" },
          timestamp: "2026-06-15T12:30:00Z",
        },
      ],
    });

    const records = normalizeGithubEvidence(payload, "github_push_webhook");
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.commit_sha)).toEqual(["aaa111", "bbb222"]);
    expect(records[0].agent_identity_raw).toBe("bot-a");
    expect(records[1].agent_identity_raw).toBe("bot-b");
  });

  it("detects human correction signals -> HUMAN_CORRECTION_OBSERVED with optional LOGIC_DETECTION", () => {
    const payload = baseGithubPush({
      commits: [
        {
          id: "rev333",
          message: "Revert \"bad agent patch\"\n\nThis reverts commit abc111.",
          url: "https://github.com/acme/agent-repo/commit/rev333",
          author: { name: "human", email: "h@local" },
          timestamp: "2026-06-16T10:00:00Z",
        },
      ],
    });

    const records = normalizeGithubEvidence(payload, "github_push_webhook");
    expect(records[0].normalized_event_type).toBe("HUMAN_CORRECTION_OBSERVED");
    expect(records[0].raw_error_classification).toBe("LOGIC_DETECTION");
  });

  it("keeps validation_signal_present false for commit-message keywords alone", () => {
    const payload = baseGithubPush({
      commits: [
        {
          id: "ci444",
          message: "fix: all tests pass and CI green",
          url: "https://github.com/acme/agent-repo/commit/ci444",
          author: { name: "bot", email: "b@local" },
          timestamp: "2026-06-16T11:00:00Z",
        },
      ],
    });

    const records = normalizeGithubEvidence(payload, "github_push_webhook");
    expect(records[0].validation_signal_present).toBe(false);
  });

  it("sets validation_signal_present true only with explicit validation artifact marker", () => {
    const payload = baseGithubPush({
      commits: [
        {
          id: "val555",
          message: "agent patch",
          url: "https://github.com/acme/agent-repo/commit/val555",
          author: { name: "bot", email: "b@local" },
          timestamp: "2026-06-16T11:30:00Z",
          validation_status: "passed",
        },
      ],
    });

    const records = normalizeGithubEvidence(payload, "github_push_webhook");
    expect(records[0].validation_signal_present).toBe(true);
    expect(records[0].normalized_event_type).toBe("VALIDATION_OBSERVED");
  });

  it("defaults weak-confidence input to UNKNOWN raw_error_classification", () => {
    const payload = baseGithubPush({
      commits: [
        {
          id: "unk666",
          message: "minor tweak",
          url: "https://github.com/acme/agent-repo/commit/unk666",
          author: { name: "bot", email: "b@local" },
          timestamp: "2026-06-16T12:00:00Z",
        },
      ],
    });

    const records = normalizeGithubEvidence(payload, "github_push_webhook");
    expect(records[0].raw_error_classification).toBe("UNKNOWN");
  });
});

describe("normalizeGenAiTrace", () => {
  it("maps invoke_agent trace to AGENT_RUN_OBSERVED with token usage", () => {
    const trace = {
      name: "invoke_agent",
      attributes: {
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.agent.id": "sweep-agent-1",
        "gen_ai.usage.input_tokens": 1200,
        "gen_ai.usage.output_tokens": 340,
        "tool.call.count": 5,
      },
      status: { code: "OK" },
      startTimeUnixNano: "1718452800000000000",
      endTimeUnixNano: "1718452805000000000",
    };

    const records = normalizeGenAiTrace(trace);
    expect(records).toHaveLength(1);
    expect(records[0].normalized_event_type).toBe("AGENT_RUN_OBSERVED");
    expect(records[0].source_type).toBe("otel_genai_trace");
    expect(records[0].token_usage_input).toBe(1200);
    expect(records[0].token_usage_output).toBe(340);
    expect(records[0].tool_call_count).toBe(5);
    expect(records[0].artifact_type).toBe("trace");
  });

  it("maps timeout/token-overflow ERROR to EXECUTION_FAILURE_OBSERVED + COMPUTE_TIMEOUT", () => {
    const trace = {
      attributes: {
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.agent.name": "runner",
      },
      status: { code: "ERROR", message: "Request timed out after 30s" },
    };

    const records = normalizeGenAiTrace(trace);
    expect(records[0].normalized_event_type).toBe("EXECUTION_FAILURE_OBSERVED");
    expect(records[0].raw_error_classification).toBe("COMPUTE_TIMEOUT");
  });

  it("tolerates semconv drift / partial fields without throwing", () => {
    const trace = {
      attributes: {
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.agent.id": "drift-agent",
        "gen_ai.usage.prompt_tokens": 50,
        "gen_ai.usage.completion_tokens": 10,
      },
      status: { code: "OK" },
    };

    const records = normalizeGenAiTrace(trace);
    expect(records).toHaveLength(1);
    expect(records[0].token_usage_input).toBe(50);
    expect(records[0].token_usage_output).toBe(10);
    expect(records[0].tool_call_count).toBeNull();
  });

  it("ignores non-invoke_agent operations (out of scope)", () => {
    const trace = {
      attributes: { "gen_ai.operation.name": "embeddings" },
      status: { code: "OK" },
    };

    expect(normalizeGenAiTrace(trace)).toEqual([]);
  });
});

describe("normalizeEvidence dispatcher", () => {
  it("routes github_push_webhook and otel_genai_trace payloads", () => {
    const github = normalizeEvidence({
      sourceType: "github_push_webhook",
      payload: baseGithubPush(),
    });
    expect(github[0].source_type).toBe("github_push_webhook");

    const otel = normalizeEvidence({
      sourceType: "otel_genai_trace",
      payload: {
        attributes: {
          "gen_ai.operation.name": "invoke_agent",
          "gen_ai.agent.id": "x",
        },
        status: { code: "OK" },
      },
    });
    expect(otel[0].source_type).toBe("otel_genai_trace");
  });
});

describe("anonymization and commitment hashing", () => {
  it("produces 64-hex commitments with no plaintext substrings", () => {
    const normalized: NormalizedEvidence = {
      source_type: "github_push_webhook",
      source_url: "https://github.com/acme/secret-repo/commit/abc",
      observed_at: new Date("2026-06-15T12:00:00Z"),
      agent_identity_raw: "cursor-agent",
      repository_raw: "acme/secret-repo",
      commit_sha: "abc111",
      branch_name: "main",
      session_log_url: "https://logs.example.com/sess-1",
      execution_started_at: null,
      execution_finished_at: null,
      token_usage_input: null,
      token_usage_output: null,
      tool_call_count: null,
      validation_signal_present: false,
      artifact_type: "commit",
      raw_error_classification: "UNKNOWN",
      normalized_event_type: "AGENT_ARTIFACT_CREATED",
      artifact_identifier: null,
    };

    const masked = toMaskedEvidence(normalized);
    expect(masked.agentIdentityCommitment).toMatch(/^[0-9a-f]{64}$/);
    expect(masked.repositoryCommitment).toMatch(/^[0-9a-f]{64}$/);
    expect(masked.sessionLogUrlCommitment).toMatch(/^[0-9a-f]{64}$/);
    expect(masked.branchCommitment).toMatch(/^[0-9a-f]{64}$/);
    expect(masked.agentIdentityCommitment).not.toContain("cursor-agent");
    expect(masked.repositoryCommitment).not.toContain("secret-repo");
    expect(masked.sessionLogUrlCommitment).not.toContain("logs.example.com");
  });

  it("commit() is deterministic under test salt", () => {
    const a = commit("same-value");
    const b = commit("same-value");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("eventCommitmentHash is stable across missing/malformed execution_started_at replays", () => {
    const base: NormalizedEvidence = {
      source_type: "github_push_webhook",
      source_url: null,
      observed_at: new Date("2026-06-15T12:00:00Z"),
      agent_identity_raw: "bot",
      repository_raw: "acme/r",
      commit_sha: "sha-stable",
      branch_name: "main",
      session_log_url: null,
      execution_started_at: undefined as unknown as null,
      execution_finished_at: null,
      token_usage_input: null,
      token_usage_output: null,
      tool_call_count: null,
      validation_signal_present: false,
      artifact_type: "commit",
      raw_error_classification: "UNKNOWN",
      normalized_event_type: "AGENT_ARTIFACT_CREATED",
      artifact_identifier: null,
    };

    const withMissing = eventCommitmentHash(base);
    const withInvalid = eventCommitmentHash({
      ...base,
      execution_started_at: new Date("not-a-real-date") as unknown as Date,
    });
    const withNull = eventCommitmentHash({ ...base, execution_started_at: null });

    expect(withMissing).toBe(withNull);
    expect(withInvalid).toBe(withNull);
    expect(withMissing).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sourceDigest fingerprints raw payload for replay triage", () => {
    const payload = { foo: "bar", nested: { z: 1 } };
    expect(sourceDigest(payload)).toMatch(/^[0-9a-f]{64}$/);
    expect(sourceDigest(payload)).toBe(sourceDigest({ nested: { z: 1 }, foo: "bar" }));
  });
});

describe("persistEvidence", () => {
  it("upserts idempotently on eventCommitmentHash with empty update", async () => {
    const payload = baseGithubPush();
    const normalized = normalizeGithubEvidence(payload, "github_push_webhook");
    const masked = toMaskedEvidence(normalized[0]);
    const digest = sourceDigest(payload);
    const hash = eventCommitmentHash(normalized[0]);

    await persistEvidence([{ ...masked, eventCommitmentHash: hash, sourceDigest: digest }]);
    await persistEvidence([{ ...masked, eventCommitmentHash: hash, sourceDigest: digest }]);

    expect(agentEvidenceUpsertMock).toHaveBeenCalledTimes(2);
    const firstCall = agentEvidenceUpsertMock.mock.calls[0][0];
    const secondCall = agentEvidenceUpsertMock.mock.calls[1][0];
    expect(firstCall.where.eventCommitmentHash).toBe(hash);
    expect(firstCall.update).toEqual({});
    expect(secondCall.where.eventCommitmentHash).toBe(hash);
    expect(secondCall.update).toEqual({});
  });
});

describe("backward compatibility", () => {
  it("does not mutate global modules on import", async () => {
    const dbModule = await import("@/lib/db");
    expect(dbModule.prisma).toBeDefined();
    expect(typeof normalizeGithubEvidence).toBe("function");
  });
});
