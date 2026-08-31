import { describe, it, expect } from "vitest";
import {
  computeConvergencePhase,
  runPreMortem,
  formatConsensusMemory,
  parseConsensusMemory,
  type ConvergenceInput,
  type ConvergenceState,
} from "@/lib/think-tank/convergence";

function makeInput(overrides: Partial<ConvergenceInput> = {}): ConvergenceInput {
  return {
    cycleNumber: 1,
    opportunities: [
      { id: "opp_1", title: "Data pipeline for AI training", expectedValue: 500, confidence: 0.8, effort: "low" },
      { id: "opp_2", title: "Crypto arbitrage bot", expectedValue: 2000, confidence: 0.3, effort: "high" },
    ],
    previousState: null,
    treasuryBalance: 1000,
    minimumViableValue: 100,
    ...overrides,
  };
}

describe("Convergence Engine", () => {
  it("hibernates when treasury is below minimum", () => {
    const result = computeConvergencePhase(makeInput({ treasuryBalance: 50 }));
    expect(result.action).toBe("hibernate");
    expect(result.rationale).toContain("below minimum");
  });

  it("discovers when no opportunities exist", () => {
    const result = computeConvergencePhase(makeInput({ opportunities: [] }));
    expect(result.action).toBe("discover");
  });

  it("validates top opportunity on first cycle", () => {
    const result = computeConvergencePhase(makeInput());
    expect(result.phase).toBe("validate");
    expect(result.action).toBe("validate");
    expect(result.selectedOpportunity?.id).toBe("opp_1");
    expect(result.goNoGo).toBe("GO"); // 500 * 0.8 = 400 >= 100
  });

  it("returns NO_GO for low-value high-effort opportunities", () => {
    const result = computeConvergencePhase(makeInput({
      opportunities: [
        { id: "opp_bad", title: "Hard low-value task", expectedValue: 50, confidence: 0.3, effort: "high" },
      ],
    }));
    expect(result.goNoGo).toBe("NO_GO");
  });

  it("executes when previous cycle was GO", () => {
    const prevState: ConvergenceState = {
      cycleNumber: 1,
      phase: "validate",
      topOpportunityId: "opp_1",
      goNoGoDecision: "GO",
      preMortemRisks: [],
      wastedCycles: 0,
      lastExecutedAt: null,
    };
    const result = computeConvergencePhase(makeInput({ previousState: prevState }));
    expect(result.action).toBe("execute");
    expect(result.selectedOpportunity?.id).toBe("opp_1");
  });

  it("discovers again after NO_GO, increments wasted cycles", () => {
    const prevState: ConvergenceState = {
      cycleNumber: 1,
      phase: "validate",
      topOpportunityId: "opp_1",
      goNoGoDecision: "NO_GO",
      preMortemRisks: ["Low confidence"],
      wastedCycles: 0,
      lastExecutedAt: null,
    };
    const result = computeConvergencePhase(makeInput({ previousState: prevState }));
    expect(result.action).toBe("discover");
  });

  it("cools down after 3 consecutive NO_GO decisions", () => {
    const prevState: ConvergenceState = {
      cycleNumber: 3,
      phase: "validate",
      topOpportunityId: null,
      goNoGoDecision: "NO_GO",
      preMortemRisks: [],
      wastedCycles: 3,
      lastExecutedAt: null,
    };
    const result = computeConvergencePhase(makeInput({ previousState: prevState }));
    expect(result.action).toBe("skip");
    expect(result.rationale).toContain("3 consecutive NO_GO");
  });

  it("resets to discover after execute completes", () => {
    const prevState: ConvergenceState = {
      cycleNumber: 5,
      phase: "execute",
      topOpportunityId: "opp_1",
      goNoGoDecision: "GO",
      preMortemRisks: [],
      wastedCycles: 0,
      lastExecutedAt: new Date().toISOString(),
    };
    const result = computeConvergencePhase(makeInput({ previousState: prevState }));
    expect(result.action).toBe("discover");
  });
});

describe("runPreMortem", () => {
  it("identifies low confidence risk", () => {
    const risks = runPreMortem({ title: "test", expectedValue: 100, confidence: 0.3, effort: "low" });
    expect(risks.some((r) => r.includes("Low confidence"))).toBe(true);
  });

  it("identifies high effort low value risk", () => {
    const risks = runPreMortem({ title: "test", expectedValue: 100, confidence: 0.9, effort: "high" });
    expect(risks.some((r) => r.includes("High effort but low expected value"))).toBe(true);
  });

  it("returns standard monitoring for clean opportunities", () => {
    const risks = runPreMortem({ title: "test", expectedValue: 500, confidence: 0.9, effort: "low" });
    expect(risks.some((r) => r.includes("No critical risks"))).toBe(true);
  });
});

describe("Consensus Memory", () => {
  it("formats and parses round-trip", () => {
    const state: ConvergenceState = {
      cycleNumber: 5,
      phase: "validate",
      topOpportunityId: "opp_42",
      goNoGoDecision: "GO",
      preMortemRisks: ["risk1"],
      wastedCycles: 1,
      lastExecutedAt: "2026-01-01T00:00:00Z",
    };
    const formatted = formatConsensusMemory(state);
    const parsed = parseConsensusMemory(formatted);
    expect(parsed?.cycleNumber).toBe(5);
    expect(parsed?.phase).toBe("validate");
    expect(parsed?.topOpportunityId).toBe("opp_42");
    expect(parsed?.goNoGoDecision).toBe("GO");
  });

  it("handles null opportunity", () => {
    const state: ConvergenceState = {
      cycleNumber: 1,
      phase: "discover",
      topOpportunityId: null,
      goNoGoDecision: null,
      preMortemRisks: [],
      wastedCycles: 0,
      lastExecutedAt: null,
    };
    const formatted = formatConsensusMemory(state);
    const parsed = parseConsensusMemory(formatted);
    expect(parsed?.topOpportunityId).toBeNull();
  });
});