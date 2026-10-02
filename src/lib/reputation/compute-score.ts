/**
 * Pure reputation scoring engine — deterministic, no DB dependency.
 *
 * Score formula (0–1000):
 *   base = min(evidenceCount, 500) * 1.0
 *   + bonus_if_enrolled (100)
 *   + success_rate_bonus: successRate * 200 (0–200)
 *   + trajectory_bonus: UP=50, FLAT=25, DOWN=0
 *   - correction_penalty: min(correctionCount, 50) * 2
 *   - failure_penalty: min(failureCount, 50) * 3
 *   + artifact_bonus: min(artifactCount, 200) * 0.5
 *
 * Final clamped to [0, 1000].
 */

export type ReputationTier = "bronze" | "silver" | "gold" | "platinum" | "diamond";

export const TIER_THRESHOLDS: Record<ReputationTier, number> = {
  bronze: 0,
  silver: 200,
  gold: 400,
  platinum: 650,
  diamond: 850,
};

export const TIER_ORDER: ReputationTier[] = ["bronze", "silver", "gold", "platinum", "diamond"];

export const TIER_COLORS: Record<ReputationTier, string> = {
  bronze: "#cd7f32",
  silver: "#c0c0c0",
  gold: "#ffd700",
  platinum: "#e5e4e2",
  diamond: "#b9f2ff",
};

export const TIER_DISPLAY: Record<ReputationTier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  diamond: "Diamond",
};

export interface ReputationInput {
  evidenceCount: number;
  artifactCount: number;
  correctionCount: number;
  failureCount: number;
  successRate30d: number | null;
  trajectory7d: "UP" | "FLAT" | "DOWN";
  isEnrolled: boolean;
  /**
   * F-002 (Sybil resistance): number of DISTINCT counterparties the evidence
   * came from. Optional for backward-compat; when provided, the tier is capped
   * so a self-dealing ring cannot reach the upper tiers on raw volume alone.
   */
  distinctCounterparties?: number;
  /** F-002: USD of externally-verified (fiat-cleared) revenue. Optional. */
  fiatBackedUsd?: number;
}

/**
 * F-002: minimum diversity/fiat needed to qualify for the upper tiers.
 * A single-operator self-deal ring has ~1 counterparty and $0 fiat, so it is
 * capped at Gold regardless of raw volume.
 */
export const DIVERSITY_MIN = {
  silver: { counterparties: 2, fiatUsd: 0 },
  gold: { counterparties: 5, fiatUsd: 100 },
  platinum: { counterparties: 10, fiatUsd: 1000 },
  diamond: { counterparties: 20, fiatUsd: 5000 },
} as const;

/** F-002: highest tier the given diversity/fiat qualifies for (pure). */
export function maxTierForDiversity(
  distinctCounterparties: number,
  fiatBackedUsd: number
): ReputationTier {
  let best: ReputationTier = "bronze";
  for (const t of TIER_ORDER) {
    if (t === "bronze") { best = "bronze"; continue; }
    const req = DIVERSITY_MIN[t as Exclude<ReputationTier, "bronze">];
    if (distinctCounterparties >= req.counterparties && fiatBackedUsd >= req.fiatUsd) {
      best = t;
    }
  }
  return best;
}

export interface ReputationResult {
  score: number;
  tier: ReputationTier;
  tierLabel: string;
  tierColor: string;
  nextTier: ReputationTier | null;
  scoreToNextTier: number;
  /** F-002: true when the tier was capped by weak counterparty diversity. */
  sybilCapped?: boolean;
  breakdown: {
    evidence: number;
    enrollment: number;
    successRate: number;
    trajectory: number;
    artifact: number;
    correctionPenalty: number;
    failurePenalty: number;
  };
}

export function computeReputationScore(input: ReputationInput): ReputationResult {
  const evidence = Math.min(input.evidenceCount, 500) * 1.0;
  const enrollment = input.isEnrolled ? 100 : 0;
  const successRate = input.successRate30d != null ? Math.round(input.successRate30d * 200) : 0;
  const trajectory = input.trajectory7d === "UP" ? 50 : input.trajectory7d === "FLAT" ? 25 : 0;
  const artifact = Math.min(input.artifactCount, 200) * 0.5;
  const correctionPenalty = Math.min(input.correctionCount, 50) * 2;
  const failurePenalty = Math.min(input.failureCount, 50) * 3;

  const raw = evidence + enrollment + successRate + trajectory + artifact - correctionPenalty - failurePenalty;
  const score = Math.max(0, Math.min(1000, Math.round(raw)));

  // F-002: when diversity/fiat inputs are supplied, cap the tier so a
  // self-dealing ring cannot reach the upper tiers on raw volume alone.
  let tier = resolveTier(score);
  let sybilCapped = false;
  if (
    typeof input.distinctCounterparties === "number" ||
    typeof input.fiatBackedUsd === "number"
  ) {
    const allowed = maxTierForDiversity(
      input.distinctCounterparties ?? 0,
      input.fiatBackedUsd ?? 0
    );
    if (TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(allowed)) {
      tier = allowed;
      sybilCapped = true;
    }
  }
  const nextTier = getNextTier(tier);
  const scoreToNextTier = nextTier ? Math.max(0, TIER_THRESHOLDS[nextTier] - score) : 0;

  return {
    score,
    tier,
    tierLabel: TIER_DISPLAY[tier],
    tierColor: TIER_COLORS[tier],
    nextTier,
    scoreToNextTier,
    sybilCapped,
    breakdown: {
      evidence: Math.round(evidence),
      enrollment,
      successRate,
      trajectory,
      artifact: Math.round(artifact),
      correctionPenalty,
      failurePenalty,
    },
  };
}

export function resolveTier(score: number): ReputationTier {
  if (score >= TIER_THRESHOLDS.diamond) return "diamond";
  if (score >= TIER_THRESHOLDS.platinum) return "platinum";
  if (score >= TIER_THRESHOLDS.gold) return "gold";
  if (score >= TIER_THRESHOLDS.silver) return "silver";
  return "bronze";
}

export function getNextTier(tier: ReputationTier): ReputationTier | null {
  const idx = TIER_ORDER.indexOf(tier);
  if (idx >= TIER_ORDER.length - 1) return null;
  return TIER_ORDER[idx + 1];
}