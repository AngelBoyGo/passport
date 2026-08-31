/**
 * Convergence Engine — adopts Auto-Company's forced convergence pattern.
 *
 * Prevents endless discovery without action. Each runtime cycle follows
 * a strict progression:
 *   Cycle 1: DISCOVER — scan for opportunities, rank by value
 *   Cycle 2: VALIDATE — pre-mortem the top opportunity, GO/NO-GO decision
 *   Cycle 3+: EXECUTE — assign tasks, deploy agents, post evidence
 *
 * Discussion-only loops are forbidden. If a cycle doesn't produce
 * actionable output, it's marked as wasted and the next cycle skips
 * to execution.
 */

export type ConvergencePhase = "discover" | "validate" | "execute" | "cooldown";

export interface ConvergenceState {
  cycleNumber: number;
  phase: ConvergencePhase;
  topOpportunityId: string | null;
  goNoGoDecision: "GO" | "NO_GO" | "PENDING" | null;
  preMortemRisks: string[];
  wastedCycles: number;
  lastExecutedAt: string | null;
}

export interface ConvergenceInput {
  cycleNumber: number;
  opportunities: Array<{
    id: string;
    title: string;
    expectedValue: number;
    confidence: number;
    effort: "low" | "medium" | "high";
  }>;
  previousState: ConvergenceState | null;
  treasuryBalance: number;
  minimumViableValue: number;
}

export interface ConvergenceOutput {
  phase: ConvergencePhase;
  action: "discover" | "validate" | "execute" | "skip" | "hibernate";
  selectedOpportunity: ConvergenceInput["opportunities"][0] | null;
  goNoGo: "GO" | "NO_GO" | null;
  risks: string[];
  rationale: string;
  nextPhase: ConvergencePhase;
}

/**
 * Determines the convergence phase for this cycle and what action to take.
 * Pure function — deterministic, no I/O.
 *
 * The key insight from Auto-Company: endless discovery is waste.
 * Force convergence within 3 cycles. If no opportunity passes validation,
 * cool down before discovering again.
 */
export function computeConvergencePhase(input: ConvergenceInput): ConvergenceOutput {
  const prev = input.previousState;
  const cycleNumber = input.cycleNumber;

  // Hibernation: treasury too low to execute anything
  if (input.treasuryBalance < input.minimumViableValue) {
    return {
      phase: "cooldown",
      action: "hibernate",
      selectedOpportunity: null,
      goNoGo: null,
      risks: ["Treasury below minimum viable threshold"],
      rationale: `Treasury (${input.treasuryBalance}) below minimum (${input.minimumViableValue}). Hibernating to preserve capital.`,
      nextPhase: "discover",
    };
  }

  // No opportunities available — go discover
  if (input.opportunities.length === 0) {
    return {
      phase: "discover",
      action: "discover",
      selectedOpportunity: null,
      goNoGo: null,
      risks: [],
      rationale: "No opportunities available. Running discovery scan.",
      nextPhase: "validate",
    };
  }

  // Determine phase from previous state
  const previousPhase = prev?.phase ?? "discover";
  const previousDecision = prev?.goNoGoDecision ?? null;

  // If previous cycle was GO, execute now
  if (previousPhase === "validate" && previousDecision === "GO") {
    const selected = input.opportunities[0]; // Highest-ranked
    return {
      phase: "execute",
      action: "execute",
      selectedOpportunity: selected,
      goNoGo: "GO",
      risks: prev?.preMortemRisks ?? [],
      rationale: `Previous cycle validated "${selected?.title}" with GO. Executing now.`,
      nextPhase: "discover",
    };
  }

  // If previous cycle was NO_GO, skip to next opportunity or cool down
  if (previousPhase === "validate" && previousDecision === "NO_GO") {
    const wastedCycles = (prev?.wastedCycles ?? 0) + 1;
    if (wastedCycles >= 3) {
      return {
        phase: "cooldown",
        action: "skip",
        selectedOpportunity: null,
        goNoGo: null,
        risks: ["3 consecutive NO_GO decisions"],
        rationale: "3 consecutive NO_GO. Cooling down before next discovery cycle to avoid wasting resources on low-quality opportunities.",
        nextPhase: "discover",
      };
    }
    return {
      phase: "discover",
      action: "discover",
      selectedOpportunity: null,
      goNoGo: null,
      risks: prev?.preMortemRisks ?? [],
      rationale: `Previous opportunity rejected (NO_GO #${wastedCycles}). Discovering new opportunities.`,
      nextPhase: "validate",
    };
  }

  // If we're in execute phase but have no GO decision, reset
  if (previousPhase === "execute") {
    return {
      phase: "discover",
      action: "discover",
      selectedOpportunity: null,
      goNoGo: null,
      risks: [],
      rationale: "Previous execution complete. Starting new discovery cycle.",
      nextPhase: "validate",
    };
  }

  // Default: run validation on the top opportunity (pre-mortem)
  const top = input.opportunities[0];
  const risks = runPreMortem(top);

  // GO/NO-GO heuristic: expected value × confidence must exceed minimum,
  // and effort must not be "high" unless expected value is exceptional
  const effectiveValue = top.expectedValue * top.confidence;
  const isViable = effectiveValue >= input.minimumViableValue;
  const isEffortAcceptable = top.effort !== "high" || top.expectedValue >= input.minimumViableValue * 3;

  const goNoGo = isViable && isEffortAcceptable ? "GO" : "NO_GO";

  return {
    phase: "validate",
    action: "validate",
    selectedOpportunity: top,
    goNoGo,
    risks,
    rationale: goNoGo === "GO"
      ? `"${top.title}" validated: effective value ${Math.round(effectiveValue)} ≥ minimum ${input.minimumViableValue}. Pre-mortem passed.`
      : `"${top.title}" rejected: effective value ${Math.round(effectiveValue)} < minimum ${input.minimumViableValue}${!isEffortAcceptable ? " or effort too high" : ""}.`,
    nextPhase: goNoGo === "GO" ? "execute" : "discover",
  };
}

/**
 * Runs a Charlie Munger-style pre-mortem on an opportunity.
 * Identifies risks before committing resources.
 * Pure function — deterministic.
 */
export function runPreMortem(opportunity: {
  title: string;
  expectedValue: number;
  confidence: number;
  effort: string;
}): string[] {
  const risks: string[] = [];

  if (opportunity.confidence < 0.5) {
    risks.push(`Low confidence (${Math.round(opportunity.confidence * 100)}%). Opportunity may not materialize.`);
  }

  if (opportunity.effort === "high" && opportunity.expectedValue < 500) {
    risks.push("High effort but low expected value. Resource-to-reward ratio is unfavorable.");
  }

  if (opportunity.confidence < 0.3) {
    risks.push("Very low confidence. This may be noise, not signal. Consider discarding.");
  }

  if (opportunity.expectedValue <= 0) {
    risks.push("Zero or negative expected value. No economic rationale for execution.");
  }

  if (risks.length === 0) {
    risks.push("No critical risks identified. Standard execution monitoring recommended.");
  }

  return risks;
}

/**
 * Formats the convergence state for persistence in consensus memory.
 * This is the "baton" passed between cycles — the only cross-cycle state.
 */
export function formatConsensusMemory(state: ConvergenceState): string {
  return [
    `# Convergence State — Cycle ${state.cycleNumber}`,
    `Phase: ${state.phase}`,
    `Top Opportunity: ${state.topOpportunityId ?? "none"}`,
    `GO/NO-GO: ${state.goNoGoDecision ?? "pending"}`,
    `Pre-mortem Risks: ${state.preMortemRisks.join("; ") || "none"}`,
    `Wasted Cycles: ${state.wastedCycles}`,
    `Last Executed: ${state.lastExecutedAt ?? "never"}`,
    ``,
    `## Next Action`,
    state.phase === "discover" ? "Run discovery scan for new opportunities." :
    state.phase === "validate" ? `Validate top opportunity: ${state.topOpportunityId}. Run pre-mortem.` :
    state.phase === "execute" ? `Execute: ${state.topOpportunityId}. Assign tasks and post evidence.` :
    "Cool down. Review strategy before next discovery cycle.",
  ].join("\n");
}

/**
 * Parses a consensus memory string back into a ConvergenceState.
 */
export function parseConsensusMemory(content: string): ConvergenceState | null {
  try {
    const cycleMatch = content.match(/Cycle (\d+)/);
    const phaseMatch = content.match(/Phase: (\w+)/);
    const opportunityMatch = content.match(/Top Opportunity: (\S+)/);
    const decisionMatch = content.match(/GO\/NO-GO: (\S+)/);
    const wastedMatch = content.match(/Wasted Cycles: (\d+)/);

    return {
      cycleNumber: cycleMatch ? parseInt(cycleMatch[1]) : 0,
      phase: (phaseMatch?.[1] as ConvergencePhase) ?? "discover",
      topOpportunityId: opportunityMatch?.[1] === "none" ? null : opportunityMatch?.[1] ?? null,
      goNoGoDecision: (decisionMatch?.[1] as "GO" | "NO_GO" | null) ?? null,
      preMortemRisks: [],
      wastedCycles: wastedMatch ? parseInt(wastedMatch[1]) : 0,
      lastExecutedAt: null,
    };
  } catch {
    return null;
  }
}