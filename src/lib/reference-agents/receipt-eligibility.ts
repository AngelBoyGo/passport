import type { MaskedAgentEvidence } from "@/lib/ingestion/github-agent-adapter";

/** Persisted evidence fields used by the receipt-eligibility predicate. */
export type EvidenceForReceiptEligibility = Pick<
  MaskedAgentEvidence,
  | "agentIdentityCommitment"
  | "sourceType"
  | "normalizedEventType"
  | "observedAt"
  | "eventCommitmentHash"
  | "commitSha"
  | "sourceUrl"
  | "validationSignalPresent"
>;

export type ReceiptEligibilityResult = {
  eligible: boolean;
  reasons: string[];
  predicateVersion: "v1";
};

const HEX_64 = /^[0-9a-f]{64}$/i;

function isValidCommitmentHash(value: string): boolean {
  return HEX_64.test(value);
}

function hasArtifactIdentifier(
  evidence: EvidenceForReceiptEligibility
): boolean {
  const sha = evidence.commitSha?.trim();
  if (sha) return true;
  const url = evidence.sourceUrl?.trim();
  return Boolean(url);
}

function isSufficientlyFormed(evidence: EvidenceForReceiptEligibility): boolean {
  if (!evidence.sourceType?.trim()) return false;
  if (!evidence.normalizedEventType?.trim()) return false;
  const ms = evidence.observedAt?.getTime();
  return Number.isFinite(ms);
}

/**
 * Pure predicate: whether persisted AgentEvidence is eligible for receipt bridging.
 *
 * Maps to classifyEnforcement posture as follows — eligibility confirms the row is
 * well-formed and dedup-safe; classifyEnforcement then assigns OBSERVATIONAL_ONLY vs
 * AUDIT_RELEVANT vs ENFORCEMENT_ELIGIBLE from normalizedEventType and validation
 * signals. bridgeEvidenceToReceipt mint path is unchanged; callers may gate on this
 * predicate before invoking the bridge.
 */
export function evaluateReceiptEligibility(
  evidence: EvidenceForReceiptEligibility
): ReceiptEligibilityResult {
  const reasons: string[] = [];
  let eligible = true;

  if (isValidCommitmentHash(evidence.agentIdentityCommitment)) {
    reasons.push("agent_identity_commitment_valid");
  } else {
    reasons.push("agent_identity_commitment_invalid");
    eligible = false;
  }

  if (hasArtifactIdentifier(evidence)) {
    reasons.push("artifact_identifier_present");
  } else {
    reasons.push("artifact_identifier_missing");
    eligible = false;
  }

  if (isValidCommitmentHash(evidence.eventCommitmentHash)) {
    reasons.push("event_commitment_hash_valid");
  } else {
    reasons.push("event_commitment_hash_invalid");
    eligible = false;
  }

  if (isSufficientlyFormed(evidence)) {
    reasons.push("evidence_sufficiently_formed");
  } else {
    reasons.push("evidence_insufficiently_formed");
    eligible = false;
  }

  if (evidence.validationSignalPresent) {
    reasons.push("human_validation_present");
  }

  return {
    eligible,
    reasons,
    predicateVersion: "v1",
  };
}
