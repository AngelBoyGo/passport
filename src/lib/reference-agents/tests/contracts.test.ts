import { describe, it, expect, beforeEach, vi } from "vitest";

const TEST_SALT = vi.hoisted(() => {
  const salt = "vitest-ingestion-commitment-salt";
  process.env.INGESTION_COMMITMENT_SALT = salt;
  return salt;
});

import repoStewardFixture from "./fixtures/repo-steward.json";
import issueTriageFixture from "./fixtures/issue-triage.json";
import complianceReportFixture from "./fixtures/compliance-report.json";
import { REFERENCE_AGENTS } from "@/lib/reference-agents/registry";
import {
  normalizeEvidence,
  normalizeGithubEvidence,
  toMaskedEvidence,
  eventCommitmentHash,
  commit,
  type NormalizedEvidence,
} from "@/lib/ingestion/github-agent-adapter";

const RAW_LEAKAGE_TOKENS = [
  "acme/agent-repo",
  "refs/heads/main",
  "https://github.com/acme/agent-repo",
  "Auth bug in login flow",
  "agent.repo-steward.v1",
  "agent.issue-triage.v1",
  "agent.compliance-evidence.v1",
  "https://logs.example.com/steward-sess-1",
  "https://logs.example.com/triage-sess-42",
  "https://logs.example.com/compliance-sess-9",
  "https://github.com/acme/agent-repo/issues/42",
  "https://compliance.example.com/reports/cc61-2026-06",
  "SOC2-CC6.1",
  "issue-42-acme",
  "report-cc61-2026-06",
];

function assertNoRawLeakage(masked: {
  agentIdentityCommitment: string;
  repositoryCommitment: string | null;
  branchCommitment: string | null;
  sessionLogUrlCommitment: string | null;
}) {
  const commitmentJson = JSON.stringify({
    agentIdentityCommitment: masked.agentIdentityCommitment,
    repositoryCommitment: masked.repositoryCommitment,
    branchCommitment: masked.branchCommitment,
    sessionLogUrlCommitment: masked.sessionLogUrlCommitment,
  });
  for (const token of RAW_LEAKAGE_TOKENS) {
    expect(commitmentJson).not.toContain(token);
  }
}

/** Pre-change github hash baseline (commit_sha primary dedup key). */
function legacyGithubEventHash(n: NormalizedEvidence): string {
  const parts = [
    n.source_type,
    n.commit_sha ?? "",
    n.normalized_event_type,
    n.execution_started_at == null ||
    !Number.isFinite(n.execution_started_at.getTime())
      ? ""
      : String(n.execution_started_at.getTime()),
  ];
  return commit(parts.join("|"));
}

beforeEach(() => {
  process.env.INGESTION_COMMITMENT_SALT = TEST_SALT;
});

describe("reference agent evidence contracts", () => {
  describe("Repo Steward (github_push_webhook)", () => {
    it("normalizes fixture to masked evidence with expected fields", () => {
      const records = normalizeEvidence({
        sourceType: "github_push_webhook",
        payload: repoStewardFixture,
      });
      expect(records).toHaveLength(1);
      const masked = toMaskedEvidence(records[0]);
      expect(masked.sourceType).toBe("github_push_webhook");
      expect(masked.artifactType).toBe("commit");
      expect(masked.normalizedEventType).toBe("AGENT_ARTIFACT_CREATED");
      expect(masked.agentIdentityCommitment).toBe(
        REFERENCE_AGENTS.REPO_STEWARD.subjectCommitment
      );
      expect(masked.commitSha).toBe("abc111def222");
      expect(masked.sessionLogUrlCommitment).toMatch(/^[0-9a-f]{64}$/);
      assertNoRawLeakage(masked);
    });

    it("dedup hash is stable on replay", () => {
      const records = normalizeEvidence({
        sourceType: "github_push_webhook",
        payload: repoStewardFixture,
      });
      const hash1 = eventCommitmentHash(records[0]);
      const hash2 = eventCommitmentHash(records[0]);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("Issue Triage (github_issue_event)", () => {
    it("normalizes fixture to masked evidence with issue artifact", () => {
      const records = normalizeEvidence({
        sourceType: "github_issue_event",
        payload: issueTriageFixture,
      });
      expect(records).toHaveLength(1);
      const n = records[0];
      expect(n.source_type).toBe("github_issue_event");
      expect(n.artifact_type).toBe("issue_label");
      expect(n.normalized_event_type).toBe("AGENT_ARTIFACT_CREATED");
      expect(n.artifact_identifier).toBe("issue-42-acme");

      const masked = toMaskedEvidence(n);
      expect(masked.agentIdentityCommitment).toBe(
        REFERENCE_AGENTS.ISSUE_TRIAGE.subjectCommitment
      );
      expect(masked.commitSha).toBeNull();
      expect(masked.sessionLogUrlCommitment).toMatch(/^[0-9a-f]{64}$/);
      assertNoRawLeakage(masked);
    });

    it("maps override action to HUMAN_CORRECTION_OBSERVED", () => {
      const records = normalizeEvidence({
        sourceType: "github_issue_event",
        payload: { ...issueTriageFixture, action: "override" },
      });
      expect(records[0].normalized_event_type).toBe(
        "HUMAN_CORRECTION_OBSERVED"
      );
    });

    it("maps accept action with validation_signal_present", () => {
      const records = normalizeEvidence({
        sourceType: "github_issue_event",
        payload: { ...issueTriageFixture, action: "accept" },
      });
      expect(records[0].validation_signal_present).toBe(true);
    });

    it("dedup hash uses artifact_identifier when commit_sha absent", () => {
      const records = normalizeEvidence({
        sourceType: "github_issue_event",
        payload: issueTriageFixture,
      });
      const hash = eventCommitmentHash(records[0]);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      const replay = normalizeEvidence({
        sourceType: "github_issue_event",
        payload: issueTriageFixture,
      });
      expect(eventCommitmentHash(replay[0])).toBe(hash);
    });
  });

  describe("Compliance Evidence (compliance_report)", () => {
    it("normalizes fixture to masked compliance report evidence", () => {
      const records = normalizeEvidence({
        sourceType: "compliance_report",
        payload: complianceReportFixture,
      });
      expect(records).toHaveLength(1);
      const n = records[0];
      expect(n.source_type).toBe("compliance_report");
      expect(n.artifact_type).toBe("compliance_report");
      expect(n.normalized_event_type).toBe("AGENT_ARTIFACT_CREATED");
      expect(n.artifact_identifier).toBe("report-cc61-2026-06");

      const masked = toMaskedEvidence(n);
      expect(masked.agentIdentityCommitment).toBe(
        REFERENCE_AGENTS.COMPLIANCE_EVIDENCE.subjectCommitment
      );
      expect(masked.repositoryCommitment).toMatch(/^[0-9a-f]{64}$/);
      assertNoRawLeakage(masked);
    });

    it("maps rejection to HUMAN_CORRECTION_OBSERVED", () => {
      const records = normalizeEvidence({
        sourceType: "compliance_report",
        payload: { ...complianceReportFixture, action: "rejected" },
      });
      expect(records[0].normalized_event_type).toBe(
        "HUMAN_CORRECTION_OBSERVED"
      );
    });

    it("maps approval with validation_signal_present", () => {
      const records = normalizeEvidence({
        sourceType: "compliance_report",
        payload: { ...complianceReportFixture, action: "approved" },
      });
      expect(records[0].validation_signal_present).toBe(true);
    });

    it("dedup hash is stable on replay", () => {
      const records = normalizeEvidence({
        sourceType: "compliance_report",
        payload: complianceReportFixture,
      });
      const hash1 = eventCommitmentHash(records[0]);
      const hash2 = eventCommitmentHash(
        normalizeEvidence({
          sourceType: "compliance_report",
          payload: complianceReportFixture,
        })[0]
      );
      expect(hash1).toBe(hash2);
    });
  });

  describe("github hash regression (backward compat)", () => {
    it("eventCommitmentHash unchanged for github commit events with commit_sha", () => {
      const records = normalizeGithubEvidence(
        repoStewardFixture,
        "github_push_webhook"
      );
      expect(records).toHaveLength(1);
      const current = eventCommitmentHash(records[0]);
      const legacy = legacyGithubEventHash(records[0]);
      expect(current).toBe(legacy);
    });

    it("existing github-telemetry baseline hash still matches", () => {
      const base: NormalizedEvidence = {
        source_type: "github_push_webhook",
        source_url: null,
        observed_at: new Date("2026-06-15T12:00:00Z"),
        agent_identity_raw: "bot",
        repository_raw: "acme/r",
        commit_sha: "sha-stable",
        branch_name: "main",
        session_log_url: null,
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
      expect(eventCommitmentHash(base)).toBe(legacyGithubEventHash(base));
    });
  });
});
