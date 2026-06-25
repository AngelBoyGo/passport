import { describe, it, expect } from "vitest";
import {
  classifyEnforcement,
  CORRECTION_THRESHOLD,
  type EvidenceForEnforcement,
} from "@/lib/evidence-bridge/predicates";

const AGENT_HASH = "a".repeat(64);

function evidence(
  overrides: Partial<EvidenceForEnforcement> = {}
): EvidenceForEnforcement {
  return {
    normalizedEventType: "AGENT_RUN_OBSERVED",
    rawErrorClassification: null,
    validationSignalPresent: false,
    ...overrides,
  };
}

describe("classifyEnforcement linkageType", () => {
  it("maps RUN and ARTIFACT events to OBSERVATION", () => {
    expect(
      classifyEnforcement(
        evidence({ normalizedEventType: "AGENT_RUN_OBSERVED" })
      ).linkageType
    ).toBe("OBSERVATION");
    expect(
      classifyEnforcement(
        evidence({ normalizedEventType: "AGENT_ARTIFACT_CREATED" })
      ).linkageType
    ).toBe("OBSERVATION");
  });

  it("maps HUMAN_CORRECTION to CORRECTION", () => {
    expect(
      classifyEnforcement(
        evidence({ normalizedEventType: "HUMAN_CORRECTION_OBSERVED" })
      ).linkageType
    ).toBe("CORRECTION");
  });

  it("maps EXECUTION_FAILURE to FAILURE", () => {
    expect(
      classifyEnforcement(
        evidence({ normalizedEventType: "EXECUTION_FAILURE_OBSERVED" })
      ).linkageType
    ).toBe("FAILURE");
  });

  it("maps VALIDATION to VALIDATION", () => {
    expect(
      classifyEnforcement(
        evidence({ normalizedEventType: "VALIDATION_OBSERVED" })
      ).linkageType
    ).toBe("VALIDATION");
  });
});

describe("classifyEnforcement OBSERVATIONAL_ONLY", () => {
  it("defaults runs and artifacts to OBSERVATIONAL_ONLY", () => {
    const run = classifyEnforcement(
      evidence({ normalizedEventType: "AGENT_RUN_OBSERVED" })
    );
    expect(run.enforcementState).toBe("OBSERVATIONAL_ONLY");

    const artifact = classifyEnforcement(
      evidence({ normalizedEventType: "AGENT_ARTIFACT_CREATED" })
    );
    expect(artifact.enforcementState).toBe("OBSERVATIONAL_ONLY");
  });

  it("treats validations as OBSERVATIONAL_ONLY", () => {
    const result = classifyEnforcement(
      evidence({
        normalizedEventType: "VALIDATION_OBSERVED",
        validationSignalPresent: true,
      })
    );
    expect(result.enforcementState).toBe("OBSERVATIONAL_ONLY");
  });

  it("treats a lone human correction as OBSERVATIONAL_ONLY", () => {
    const result = classifyEnforcement(
      evidence({ normalizedEventType: "HUMAN_CORRECTION_OBSERVED" }),
      { priorCorrectionCount: 0 }
    );
    expect(result.enforcementState).toBe("OBSERVATIONAL_ONLY");
  });

  it("never auto-slashes COMPUTE_TIMEOUT failures (OBSERVATIONAL_ONLY)", () => {
    const result = classifyEnforcement(
      evidence({
        normalizedEventType: "EXECUTION_FAILURE_OBSERVED",
        rawErrorClassification: "COMPUTE_TIMEOUT",
        validationSignalPresent: true,
      })
    );
    expect(result.enforcementState).toBe("OBSERVATIONAL_ONLY");
    expect(result.enforcementState).not.toBe("ENFORCEMENT_ELIGIBLE");
  });
});

describe("classifyEnforcement AUDIT_RELEVANT", () => {
  it("flags any EXECUTION_FAILURE_OBSERVED as AUDIT_RELEVANT when not enforcement-eligible", () => {
    const result = classifyEnforcement(
      evidence({
        normalizedEventType: "EXECUTION_FAILURE_OBSERVED",
        rawErrorClassification: "UNKNOWN",
      })
    );
    expect(result.enforcementState).toBe("AUDIT_RELEVANT");
  });

  it("flags HUMAN_CORRECTION with LOGIC_DETECTION as AUDIT_RELEVANT", () => {
    const result = classifyEnforcement(
      evidence({
        normalizedEventType: "HUMAN_CORRECTION_OBSERVED",
        rawErrorClassification: "LOGIC_DETECTION",
      }),
      { priorCorrectionCount: 0 }
    );
    expect(result.enforcementState).toBe("AUDIT_RELEVANT");
  });

  it(`flags repeated corrections at threshold (${CORRECTION_THRESHOLD}) as AUDIT_RELEVANT`, () => {
    const result = classifyEnforcement(
      evidence({ normalizedEventType: "HUMAN_CORRECTION_OBSERVED" }),
      { priorCorrectionCount: CORRECTION_THRESHOLD }
    );
    expect(result.enforcementState).toBe("AUDIT_RELEVANT");
  });
});

describe("classifyEnforcement ENFORCEMENT_ELIGIBLE", () => {
  it("requires validated logic-detection failure for ENFORCEMENT_ELIGIBLE", () => {
    const result = classifyEnforcement(
      evidence({
        normalizedEventType: "EXECUTION_FAILURE_OBSERVED",
        rawErrorClassification: "LOGIC_DETECTION",
        validationSignalPresent: true,
      })
    );
    expect(result.enforcementState).toBe("ENFORCEMENT_ELIGIBLE");
    expect(result.predicateVersion).toBe("v1");
  });

  it("does not mark logic failure without validation signal as ENFORCEMENT_ELIGIBLE", () => {
    const result = classifyEnforcement(
      evidence({
        normalizedEventType: "EXECUTION_FAILURE_OBSERVED",
        rawErrorClassification: "LOGIC_DETECTION",
        validationSignalPresent: false,
      })
    );
    expect(result.enforcementState).toBe("AUDIT_RELEVANT");
    expect(result.enforcementState).not.toBe("ENFORCEMENT_ELIGIBLE");
  });

  it("never marks human correction alone as ENFORCEMENT_ELIGIBLE", () => {
    const result = classifyEnforcement(
      evidence({
        normalizedEventType: "HUMAN_CORRECTION_OBSERVED",
        rawErrorClassification: "LOGIC_DETECTION",
        validationSignalPresent: true,
      }),
      { priorCorrectionCount: CORRECTION_THRESHOLD }
    );
    expect(result.enforcementState).not.toBe("ENFORCEMENT_ELIGIBLE");
  });
});
