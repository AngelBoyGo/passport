import {
  commit,
  type ArtifactType,
  type SourceType,
} from "@/lib/ingestion/github-agent-adapter";

/** Stable keys for the three 3-aaamigas reference agents. */
export type ReferenceAgentKey =
  | "REPO_STEWARD"
  | "ISSUE_TRIAGE"
  | "COMPLIANCE_EVIDENCE";

export type ReferenceAgentDefinition = {
  key: ReferenceAgentKey;
  /** Stable raw identity string for anonymous/library fixture ingestion. */
  rawIdentity: string;
  /** Salted observed commitment used by non-enrolled reference fixtures. */
  subjectCommitment: string;
  label: string;
  sourceTypes: readonly SourceType[];
  artifactTypes: readonly ArtifactType[];
};

/**
 * Canonical reference-agent registry for library fixtures. These commitments
 * mirror anonymous masked evidence; enrolled external agents use key-derived
 * Passport commitments and the signed evidence route instead.
 */
export const REFERENCE_AGENTS: Record<ReferenceAgentKey, ReferenceAgentDefinition> =
  {
    REPO_STEWARD: {
      key: "REPO_STEWARD",
      rawIdentity: "agent.repo-steward.v1",
      subjectCommitment: commit("agent.repo-steward.v1"),
      label: "Repo Steward",
      sourceTypes: ["github_push_webhook", "github_commit_payload"],
      artifactTypes: ["commit", "pull_request"],
    },
    ISSUE_TRIAGE: {
      key: "ISSUE_TRIAGE",
      rawIdentity: "agent.issue-triage.v1",
      subjectCommitment: commit("agent.issue-triage.v1"),
      label: "Issue Triage Agent",
      sourceTypes: ["github_issue_event"],
      artifactTypes: ["issue", "issue_label"],
    },
    COMPLIANCE_EVIDENCE: {
      key: "COMPLIANCE_EVIDENCE",
      rawIdentity: "agent.compliance-evidence.v1",
      subjectCommitment: commit("agent.compliance-evidence.v1"),
      label: "Compliance Evidence Agent",
      sourceTypes: ["compliance_report"],
      artifactTypes: ["compliance_report"],
    },
  };

/** All reference agent definitions in stable key order. */
export const REFERENCE_AGENT_LIST: ReferenceAgentDefinition[] = Object.values(
  REFERENCE_AGENTS
);

/**
 * Resolves a reference agent by its 64-hex subjectCommitment (case-insensitive).
 */
export function resolveReferenceAgentBySubject(
  commitment: string
): ReferenceAgentDefinition | null {
  const normalized = commitment.toLowerCase();
  for (const agent of REFERENCE_AGENT_LIST) {
    if (agent.subjectCommitment.toLowerCase() === normalized) {
      return agent;
    }
  }
  return null;
}
