import { describe, it, expect } from "vitest";
import {
  evaluateReceiptEligibility,
  type EvidenceForReceiptEligibility,
} from "@/lib/reference-agents/receipt-eligibility";
import { REFERENCE_AGENTS } from "@/lib/reference-agents/registry";

const VALID_HASH = "a".repeat(64);

function wellFormedEvidence(
  overrides: Partial<EvidenceForReceiptEligibility> = {}
): EvidenceForReceiptEligibility {
  return {
    agentIdentityCommitment: REFERENCE_AGENTS.REPO_STEWARD.subjectCommitment,
    sourceType: "github_push_webhook",
    normalizedEventType: "AGENT_ARTIFACT_CREATED",
    observedAt: new Date("2026-06-15T12:00:00Z"),
    eventCommitmentHash: VALID_HASH,
    commitSha: "abc111def222",
    sourceUrl: null,
    validationSignalPresent: false,
    ...overrides,
  };
}

describe("evaluateReceiptEligibility", () => {
  it("returns eligible for well-formed evidence with commitSha identifier", () => {
    const result = evaluateReceiptEligibility(wellFormedEvidence());
    expect(result.eligible).toBe(true);
    expect(result.predicateVersion).toBe("v1");
    expect(result.reasons).toContain("agent_identity_commitment_valid");
    expect(result.reasons).toContain("artifact_identifier_present");
    expect(result.reasons).toContain("event_commitment_hash_valid");
    expect(result.reasons).toContain("evidence_sufficiently_formed");
  });

  it("returns eligible for issue events identified by sourceUrl", () => {
    const result = evaluateReceiptEligibility(
      wellFormedEvidence({
        agentIdentityCommitment:
          REFERENCE_AGENTS.ISSUE_TRIAGE.subjectCommitment,
        sourceType: "github_issue_event",
        commitSha: null,
        sourceUrl: "https://github.com/acme/agent-repo/issues/42",
      })
    );
    expect(result.eligible).toBe(true);
    expect(result.reasons).toContain("artifact_identifier_present");
  });

  it("records validation bonus without requiring it", () => {
    const without = evaluateReceiptEligibility(wellFormedEvidence());
    const withValidation = evaluateReceiptEligibility(
      wellFormedEvidence({ validationSignalPresent: true })
    );
    expect(without.eligible).toBe(true);
    expect(withValidation.eligible).toBe(true);
    expect(withValidation.reasons).toContain("human_validation_present");
    expect(without.reasons).not.toContain("human_validation_present");
  });

  it("rejects missing or malformed agent identity commitment", () => {
    const missing = evaluateReceiptEligibility(
      wellFormedEvidence({ agentIdentityCommitment: "" })
    );
    expect(missing.eligible).toBe(false);
    expect(missing.reasons).toContain("agent_identity_commitment_invalid");

    const malformed = evaluateReceiptEligibility(
      wellFormedEvidence({ agentIdentityCommitment: "short" })
    );
    expect(malformed.eligible).toBe(false);
    expect(malformed.reasons).toContain("agent_identity_commitment_invalid");
  });

  it("rejects missing artifact identifier (no commitSha or sourceUrl)", () => {
    const result = evaluateReceiptEligibility(
      wellFormedEvidence({ commitSha: null, sourceUrl: null })
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("artifact_identifier_missing");
  });

  it("rejects malformed eventCommitmentHash", () => {
    const result = evaluateReceiptEligibility(
      wellFormedEvidence({ eventCommitmentHash: "not-a-hash" })
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("event_commitment_hash_invalid");
  });

  it("rejects insufficiently formed evidence missing required fields", () => {
    const result = evaluateReceiptEligibility(
      wellFormedEvidence({
        sourceType: "" as unknown as import("@/lib/ingestion/github-agent-adapter").SourceType,
        normalizedEventType: "" as unknown as import("@/lib/ingestion/github-agent-adapter").NormalizedEventType,
        observedAt: new Date("invalid"),
      })
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("evidence_insufficiently_formed");
  });
});
