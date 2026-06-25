import { describe, it, expect, beforeEach, vi } from "vitest";

const TEST_SALT = vi.hoisted(() => {
  const salt = "vitest-ingestion-commitment-salt";
  process.env.INGESTION_COMMITMENT_SALT = salt;
  return salt;
});

import {
  REFERENCE_AGENTS,
  REFERENCE_AGENT_LIST,
  resolveReferenceAgentBySubject,
} from "@/lib/reference-agents/registry";
import { commit } from "@/lib/ingestion/github-agent-adapter";

beforeEach(() => {
  process.env.INGESTION_COMMITMENT_SALT = TEST_SALT;
});

describe("REFERENCE_AGENTS registry", () => {
  it("defines three agents with stable rawIdentity strings", () => {
    expect(REFERENCE_AGENT_LIST).toHaveLength(3);
    expect(REFERENCE_AGENTS.REPO_STEWARD.rawIdentity).toBe(
      "agent.repo-steward.v1"
    );
    expect(REFERENCE_AGENTS.ISSUE_TRIAGE.rawIdentity).toBe(
      "agent.issue-triage.v1"
    );
    expect(REFERENCE_AGENTS.COMPLIANCE_EVIDENCE.rawIdentity).toBe(
      "agent.compliance-evidence.v1"
    );
  });

  it("produces valid 64-hex subjectCommitments via commit(rawIdentity)", () => {
    for (const agent of REFERENCE_AGENT_LIST) {
      expect(agent.subjectCommitment).toMatch(/^[0-9a-f]{64}$/);
      expect(agent.subjectCommitment).toBe(commit(agent.rawIdentity));
    }
  });

  it("subjectCommitments are deterministic under stable salt", () => {
    const first = REFERENCE_AGENTS.REPO_STEWARD.subjectCommitment;
    const second = commit("agent.repo-steward.v1");
    expect(first).toBe(second);
  });

  it("subjectCommitments are distinct per agent", () => {
    const commitments = REFERENCE_AGENT_LIST.map((a) => a.subjectCommitment);
    expect(new Set(commitments).size).toBe(3);
  });

  it("round-trips resolveReferenceAgentBySubject by commitment", () => {
    for (const agent of REFERENCE_AGENT_LIST) {
      const resolved = resolveReferenceAgentBySubject(agent.subjectCommitment);
      expect(resolved).not.toBeNull();
      expect(resolved!.key).toBe(agent.key);
    }
    expect(
      resolveReferenceAgentBySubject(
        REFERENCE_AGENTS.REPO_STEWARD.subjectCommitment.toUpperCase()
      )
    ).not.toBeNull();
  });

  it("returns null for unknown commitment", () => {
    expect(resolveReferenceAgentBySubject("f".repeat(64))).toBeNull();
    expect(resolveReferenceAgentBySubject("not-a-hash")).toBeNull();
  });
});
