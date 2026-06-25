import type {
  EvidenceEnforcementState,
  EvidenceLinkageType,
} from "@prisma/client";

/** Minimum prior corrections before repeated-correction audit relevance. */
export const CORRECTION_THRESHOLD = 3;

/** Evidence fields required for pure enforcement classification. */
export type EvidenceForEnforcement = {
  normalizedEventType: string;
  rawErrorClassification: string | null;
  validationSignalPresent: boolean;
};

export type ClassifyEnforcementOptions = {
  priorCorrectionCount?: number;
};

export type EnforcementClassification = {
  enforcementState: EvidenceEnforcementState;
  linkageType: EvidenceLinkageType;
  predicateVersion: "v1";
};

/**
 * Maps normalized event type to bridge linkage type.
 */
function linkageTypeFromEventType(
  normalizedEventType: string
): EvidenceLinkageType {
  switch (normalizedEventType) {
    case "AGENT_RUN_OBSERVED":
    case "AGENT_ARTIFACT_CREATED":
      return "OBSERVATION";
    case "HUMAN_CORRECTION_OBSERVED":
      return "CORRECTION";
    case "EXECUTION_FAILURE_OBSERVED":
      return "FAILURE";
    case "VALIDATION_OBSERVED":
      return "VALIDATION";
    default:
      return "OBSERVATION";
  }
}

/**
 * Classifies enforcement posture for public evidence (pure, v1 rules).
 */
export function classifyEnforcement(
  evidence: EvidenceForEnforcement,
  opts: ClassifyEnforcementOptions = {}
): EnforcementClassification {
  const linkageType = linkageTypeFromEventType(evidence.normalizedEventType);
  const priorCorrectionCount = opts.priorCorrectionCount ?? 0;

  let enforcementState: EvidenceEnforcementState = "OBSERVATIONAL_ONLY";

  const isLogicFailure =
    evidence.normalizedEventType === "EXECUTION_FAILURE_OBSERVED" &&
    evidence.rawErrorClassification === "LOGIC_DETECTION" &&
    evidence.validationSignalPresent;

  const isComputeTimeout =
    evidence.rawErrorClassification === "COMPUTE_TIMEOUT";

  if (
    isLogicFailure &&
    !isComputeTimeout
  ) {
    enforcementState = "ENFORCEMENT_ELIGIBLE";
  } else if (
    evidence.normalizedEventType === "EXECUTION_FAILURE_OBSERVED" &&
    !isComputeTimeout
  ) {
    enforcementState = "AUDIT_RELEVANT";
  } else if (
    evidence.normalizedEventType === "HUMAN_CORRECTION_OBSERVED" &&
    evidence.rawErrorClassification === "LOGIC_DETECTION"
  ) {
    enforcementState = "AUDIT_RELEVANT";
  } else if (
    evidence.normalizedEventType === "HUMAN_CORRECTION_OBSERVED" &&
    priorCorrectionCount >= CORRECTION_THRESHOLD
  ) {
    enforcementState = "AUDIT_RELEVANT";
  }

  return {
    enforcementState,
    linkageType,
    predicateVersion: "v1",
  };
}
