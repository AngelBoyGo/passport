/**
 * Candidate policy decision function (Phase 43).
 *
 * The brain's learnable surface is a set of ALLOWLISTED THRESHOLDS — never money
 * rules, never the action allowlist itself. A policy is a plain params object;
 * the same schema validates every candidate, and the decision function is pure
 * and deterministic so replays are reproducible bit-for-bit.
 *
 * Mirrors the SYSTEM_PROMPT's guidance so LLM decisions and policy decisions are
 * comparable: integrity issues -> attestation; broken/disabled rails -> tick;
 * open disputes -> investigate; stale research -> scan; else NOOP.
 */

export interface PolicyParams {
  /** Minimum integrity issues before TRIGGER_ATTESTATION (default: 1). */
  minIntegrityIssuesForAttestation: number;
  /** Minimum quarantined rails before RUN_TICK health execution (default: 1). */
  minQuarantinedRailsForTick: number;
  /** Minimum open disputes before INVESTIGATE_DISPUTE (default: 1). */
  minOpenDisputesForInvestigate: number;
  /** Cycles since last research scan before RUN_RESEARCH_SCAN (default: 36 ≈ 6h at 10-min cadence). */
  maxCyclesSinceResearchScan: number;
}

/** Single source of truth for the DEFAULT policy — what the LLM is nudged toward today. */
export const DEFAULT_POLICY: PolicyParams = {
  minIntegrityIssuesForAttestation: 1,
  minQuarantinedRailsForTick: 1,
  minOpenDisputesForInvestigate: 1,
  maxCyclesSinceResearchScan: 36,
};

export interface PolicyDatapoints {
  integrity: { ok: boolean; issues: string[] };
  rails: { enabled: number; quarantined: number };
  disputes_open: number;
  /** Cycles since the last research scan (null = unknown/never). */
  cycles_since_research_scan: number | null;
}

export interface PolicyDecision {
  action: string;
  params: Record<string, unknown>;
  rationale: string;
}

/** Validates and clamps a candidate policy. Out-of-range values snap to defaults — candidates cannot disable safety thresholds. */
export function normalizePolicyParams(raw: unknown): PolicyParams {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, def: number, min: number, max: number): number => {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  return {
    minIntegrityIssuesForAttestation: num(
      obj.minIntegrityIssuesForAttestation,
      DEFAULT_POLICY.minIntegrityIssuesForAttestation, 1, 10
    ),
    minQuarantinedRailsForTick: num(
      obj.minQuarantinedRailsForTick,
      DEFAULT_POLICY.minQuarantinedRailsForTick, 1, 10
    ),
    minOpenDisputesForInvestigate: num(
      obj.minOpenDisputesForInvestigate,
      DEFAULT_POLICY.minOpenDisputesForInvestigate, 1, 20
    ),
    maxCyclesSinceResearchScan: num(
      obj.maxCyclesSinceResearchScan,
      DEFAULT_POLICY.maxCyclesSinceResearchScan, 6, 720
    ),
  };
}

/**
 * Deterministic decision for one cycle given datapoints and policy thresholds.
 * Priority order matches the brain's SYSTEM_PROMPT guidance exactly.
 */
export function decideFromPolicy(dp: PolicyDatapoints, policy: PolicyParams): PolicyDecision {
  const integrityIssues = dp.integrity?.issues?.length ?? 0;
  if (!dp.integrity?.ok || integrityIssues >= policy.minIntegrityIssuesForAttestation) {
    return {
      action: "TRIGGER_ATTESTATION",
      params: {},
      rationale: `policy: integrity ${dp.integrity?.ok ? "ok" : "failed"} with ${integrityIssues} issue(s) >= ${policy.minIntegrityIssuesForAttestation}`,
    };
  }

  if ((dp.rails?.quarantined ?? 0) >= policy.minQuarantinedRailsForTick) {
    return {
      action: "RUN_TICK",
      params: {},
      rationale: `policy: ${dp.rails.quarantined} quarantined rail(s) >= ${policy.minQuarantinedRailsForTick}`,
    };
  }

  if (dp.disputes_open >= policy.minOpenDisputesForInvestigate) {
    return {
      action: "INVESTIGATE_DISPUTE",
      params: {},
      rationale: `policy: ${dp.disputes_open} open dispute(s) >= ${policy.minOpenDisputesForInvestigate}`,
    };
  }

  if (
    dp.cycles_since_research_scan != null &&
    dp.cycles_since_research_scan >= policy.maxCyclesSinceResearchScan
  ) {
    return {
      action: "RUN_RESEARCH_SCAN",
      params: {},
      rationale: `policy: research stale (${dp.cycles_since_research_scan} cycles >= ${policy.maxCyclesSinceResearchScan})`,
    };
  }

  return { action: "NOOP", params: {}, rationale: "policy: no threshold exceeded" };
}