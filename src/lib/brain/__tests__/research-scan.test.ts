import { describe, it, expect } from "vitest";
import { isOutcomeSuccessful } from "../outcomes";
import { parseResearchScan } from "../research-scan";

describe("isOutcomeSuccessful", () => {
  it("treats ok and ok:... as success", () => {
    expect(isOutcomeSuccessful("ok")).toBe(true);
    expect(isOutcomeSuccessful("ok: findings=2")).toBe(true);
  });

  it("treats errors, classes, and null as failure", () => {
    expect(isOutcomeSuccessful("error: boom")).toBe(false);
    expect(isOutcomeSuccessful("LLM_UNAVAILABLE")).toBe(false);
    expect(isOutcomeSuccessful("INVALID_PARAMS")).toBe(false);
    expect(isOutcomeSuccessful(null)).toBe(false);
    expect(isOutcomeSuccessful(undefined)).toBe(false);
  });
});

describe("parseResearchScan", () => {
  it("parses well-formed findings and hypotheses", () => {
    const out = parseResearchScan({
      findings: [
        { title: "Stale discovery", severity: "medium", evidence: "7d evidence=0", recommendation: "run scan" },
      ],
      hypotheses: [
        { objective: "Reduce disputes", expected_improvement: "-20% open disputes", risk: "low" },
      ],
    });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].severity).toBe("medium");
    expect(out.hypotheses).toHaveLength(1);
    expect(out.hypotheses[0].risk).toBe("low");
  });

  it("drops malformed rows and clamps unknown severity/risk to low", () => {
    const out = parseResearchScan({
      findings: [
        { title: "", severity: "critical", evidence: "e", recommendation: "r" }, // no title
        { title: "t", severity: "not-a-severity", evidence: "e", recommendation: "r" }, // bad severity
        "not-an-object",
      ],
      hypotheses: [{ objective: "o" }], // missing expected_improvement
    });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].severity).toBe("low");
    expect(out.hypotheses).toHaveLength(0);
  });

  it("handles non-array fields", () => {
    const out = parseResearchScan({ findings: "nope", hypotheses: 42 });
    expect(out.findings).toHaveLength(0);
    expect(out.hypotheses).toHaveLength(0);
  });

  it("caps findings at 10 and hypotheses at 5", () => {
    const findings = Array.from({ length: 15 }, (_, i) => ({
      title: `f${i}`,
      severity: "low",
      evidence: "e",
      recommendation: "r",
    }));
    const hypotheses = Array.from({ length: 8 }, (_, i) => ({
      objective: `h${i}`,
      expected_improvement: "e",
      risk: "low",
    }));
    const out = parseResearchScan({ findings, hypotheses });
    expect(out.findings).toHaveLength(10);
    expect(out.hypotheses).toHaveLength(5);
  });
});