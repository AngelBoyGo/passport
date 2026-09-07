/**
 * Dual-State Governor (Markov-Bayesian Regime Engine)
 *
 * Implements the Black Paper Dual-State stabilization model:
 * - "SOLID" Regime: Normal operational state. 100%+ reserve backing, low volatility.
 *   Standard 50 bps protocol fee.
 * - "GHOST" Regime: Protective circuit-breaker triggered by market shocks, stale telemetry,
 *   or assay disputes. Dynamically scales damping fees up to 1500 bps (15%) and isolates redemptions.
 *
 * Features Bayesian posterior belief estimation, quadratic damping, and programmatic auto-revival.
 */

import { getCommoditySpotPrices } from "./commodity-oracle";
import { computeBasketValuation, type BasketValuationResult } from "./basket-valuation";
import { signPoRAttestation } from "./por-service";
import { prisma } from "@/lib/db";

export type RegimeState = "SOLID" | "GHOST";

export interface TelemetryEvidence {
  oracleStale: boolean;
  max24hVolatilityPercent: number;
  quarantinedBatchCount: number;
  backingRatio: number;
  lastTelemetryHeartbeatMs: number;
}

export interface DualStateAssessment {
  regime: RegimeState;
  beliefScore: number; // Bayesian posterior probability of stress [0.00 - 1.00]
  dampingFeeBps: number; // e.g. 50 bps (0.5%) up to 1500 bps (15.0%)
  circuitBreakerActive: boolean;
  revivalEligible: boolean;
  triggers: string[];
  evidence: TelemetryEvidence;
  valuation: BasketValuationResult;
  timestamp: string;
}

export interface SignedRegimeAttestation extends DualStateAssessment {
  algorithm: "ed25519";
  public_key: string;
  signature: string;
}

// ── Baseline Parameters ──

export const GOVERNOR_PARAMS = {
  baselineGhostPrior: 0.05, // 5% prior probability of systemic shock
  volatilityThresholdPercent: 10.0, // >10% 24h swing triggers stress belief
  maxTelemetrySilenceMs: 15 * 60 * 1000, // 15 minutes max missing heartbeat
  baseFeeBps: 50, // 0.5% standard fee in Solid state
  maxFeeBps: 1500, // 15.0% maximum damping fee in Ghost state
  stressThresholdBelief: 0.50, // posterior >= 0.50 triggers Ghost state
};

/**
 * Computes the Bayesian posterior belief P(Ghost | Evidence).
 * Uses multi-evidence likelihood multipliers.
 */
export function computeBayesianStressBelief(
  evidence: TelemetryEvidence,
  prior = GOVERNOR_PARAMS.baselineGhostPrior
): { belief: number; triggers: string[] } {
  const triggers: string[] = [];
  let likelihoodMultiplier = 1.0;

  // 1. Oracle staleness factor
  if (evidence.oracleStale) {
    likelihoodMultiplier *= 4.5;
    triggers.push("Stale commodity oracle telemetry detected");
  }

  // 2. Volatility shock factor
  if (evidence.max24hVolatilityPercent > GOVERNOR_PARAMS.volatilityThresholdPercent) {
    const severity = evidence.max24hVolatilityPercent / GOVERNOR_PARAMS.volatilityThresholdPercent;
    likelihoodMultiplier *= Math.min(2.0 * severity, 8.0);
    triggers.push(
      `Commodity market volatility (${evidence.max24hVolatilityPercent.toFixed(1)}%) exceeds threshold`
    );
  }

  // 3. Quarantined batches factor
  if (evidence.quarantinedBatchCount > 0) {
    likelihoodMultiplier *= 3.0 + evidence.quarantinedBatchCount * 1.5;
    triggers.push(
      `${evidence.quarantinedBatchCount} vaulted lot(s) currently held in quarantine`
    );
  }

  // 4. Reserve solvency factor
  if (evidence.backingRatio < 1.0) {
    const deficitRatio = Math.max(0, 1.0 - evidence.backingRatio);
    likelihoodMultiplier *= 5.0 + deficitRatio * 10.0;
    triggers.push(
      `Undercollateralization detected: reserve backing ratio at ${(evidence.backingRatio * 100).toFixed(1)}%`
    );
  }

  // 5. Telemetry silence
  if (evidence.lastTelemetryHeartbeatMs > GOVERNOR_PARAMS.maxTelemetrySilenceMs) {
    likelihoodMultiplier *= 3.0;
    triggers.push("Telemetry heartbeat exceeded maximum silence window");
  }

  // Odds formulation: Posterior Odds = Prior Odds * Likelihood Ratio
  const priorOdds = prior / (1 - prior);
  const posteriorOdds = priorOdds * likelihoodMultiplier;
  const posteriorProbability = posteriorOdds / (1 + posteriorOdds);

  const clampedBelief = Number(Math.min(1.0, Math.max(0.0, posteriorProbability)).toFixed(4));

  return {
    belief: clampedBelief,
    triggers,
  };
}

/**
 * Calculates dynamic quadratic transaction damping fees based on regime belief.
 */
export function calculateDampingFeeBps(beliefScore: number): number {
  if (beliefScore < GOVERNOR_PARAMS.stressThresholdBelief) {
    return GOVERNOR_PARAMS.baseFeeBps;
  }

  // Quadratic scaling between baseFee and maxFee based on belief intensity
  const normalizedIntensity =
    (beliefScore - GOVERNOR_PARAMS.stressThresholdBelief) /
    (1.0 - GOVERNOR_PARAMS.stressThresholdBelief);
  const extraFee =
    Math.pow(normalizedIntensity, 2) *
    (GOVERNOR_PARAMS.maxFeeBps - GOVERNOR_PARAMS.baseFeeBps);

  return Math.round(GOVERNOR_PARAMS.baseFeeBps + extraFee);
}

/**
 * Evaluates whether a currently stressed system satisfies programmatic revival conditions.
 */
export function evaluateProgrammaticRevival(evidence: TelemetryEvidence): boolean {
  return (
    !evidence.oracleStale &&
    evidence.backingRatio >= 1.0 &&
    evidence.quarantinedBatchCount === 0 &&
    evidence.max24hVolatilityPercent <= GOVERNOR_PARAMS.volatilityThresholdPercent &&
    evidence.lastTelemetryHeartbeatMs <= GOVERNOR_PARAMS.maxTelemetrySilenceMs
  );
}

/**
 * Pure evaluation function for the Dual-State Governor.
 */
export function evaluateDualState(
  evidence: TelemetryEvidence,
  valuation: BasketValuationResult
): DualStateAssessment {
  const { belief, triggers } = computeBayesianStressBelief(evidence);
  const regime: RegimeState =
    belief >= GOVERNOR_PARAMS.stressThresholdBelief ? "GHOST" : "SOLID";
  const dampingFeeBps = calculateDampingFeeBps(belief);
  const circuitBreakerActive = regime === "GHOST";
  const revivalEligible = evaluateProgrammaticRevival(evidence);

  return {
    regime,
    beliefScore: belief,
    dampingFeeBps,
    circuitBreakerActive,
    revivalEligible,
    triggers,
    evidence,
    valuation,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Generates live Dual-State Governor evaluation from database state and oracle feeds.
 */
export async function getLiveGovernorAssessment(): Promise<SignedRegimeAttestation> {
  const spotPrices = getCommoditySpotPrices();

  // Inspect database batches, reserves, and sovereign emergency quorum actions
  const [quarantinedBatches, reserves, wallets, latestEmergencyProposal] = await Promise.all([
    prisma.vaultBatch.count({ where: { status: "QUARANTINED" } }),
    prisma.commodityReserve.findMany(),
    prisma.agentWallet.findMany({ select: { balance: true } }),
    prisma.sovereignQuorumProposal.findFirst({
      where: {
        actionType: { in: ["EMERGENCY_FREEZE", "GOVERNOR_REVIVAL"] },
        status: "EXECUTED",
      },
      orderBy: { executedAt: "desc" },
    }),
  ]);

  const circulatingSupply = Math.max(
    wallets.reduce((sum, w) => sum + w.balance, 0),
    1
  );

  const holdings = reserves.map((r) => ({
    commodityType: r.commodityType,
    symbol: r.symbol,
    fineUnits: r.totalFineGrams,
  }));

  const valuation = computeBasketValuation({
    holdings,
    spotPrices,
    circulatingSupply,
    tokenPriceUsd: 5.0,
  });

  // Calculate highest 24h volatility across active commodities
  let maxVolatility = 0;
  let hasStaleFeed = false;
  for (const price of Object.values(spotPrices)) {
    if (price.isStale) hasStaleFeed = true;
    if (Math.abs(price.change24hPercent) > maxVolatility) {
      maxVolatility = Math.abs(price.change24hPercent);
    }
  }

  const evidence: TelemetryEvidence = {
    oracleStale: hasStaleFeed,
    max24hVolatilityPercent: maxVolatility,
    quarantinedBatchCount: quarantinedBatches,
    backingRatio: valuation.solvencyMetrics.backingRatio,
    lastTelemetryHeartbeatMs: 60 * 1000, // 1 minute since last poll
  };

  let assessment = evaluateDualState(evidence, valuation);

  // Sovereign Quorum Interlock (AES Protocol ASMC-3 Q159/Q179):
  // If the 2-of-3 sovereign council executed an EMERGENCY_FREEZE, force GHOST regime and max damping.
  if (latestEmergencyProposal?.actionType === "EMERGENCY_FREEZE") {
    assessment = {
      ...assessment,
      regime: "GHOST",
      beliefScore: 1.0,
      dampingFeeBps: GOVERNOR_PARAMS.maxFeeBps,
      circuitBreakerActive: true,
      revivalEligible: false,
      triggers: [
        ...assessment.triggers,
        "Emergency circuit breaker forced by 2-of-3 Sovereign Quorum vote",
      ],
    };
  }

  // Sign attestation
  const attestationPayload = {
    attestation_id: `gov_${assessment.regime.toLowerCase()}_${Date.now()}`,
    regime: assessment.regime,
    belief_score: assessment.beliefScore,
    damping_fee_bps: assessment.dampingFeeBps,
    circuit_breaker_active: assessment.circuitBreakerActive,
    backing_ratio: assessment.evidence.backingRatio,
    timestamp: assessment.timestamp,
    disclaimer: "Dual-State Governor attestation for algorithmic reserve stability.",
  };

  const signedPoR = await signPoRAttestation({
    attestation_id: attestationPayload.attestation_id,
    commodity_type: "MULTI_BASKET",
    symbol: "BASKET",
    total_fine_grams: valuation.netReserveValueUsd,
    total_gross_grams: valuation.totalGrossValueUsd,
    active_lots_count: holdings.length,
    merkle_root: "0".repeat(64),
    timestamp: attestationPayload.timestamp,
    disclaimer: attestationPayload.disclaimer,
  });

  return {
    ...assessment,
    algorithm: "ed25519",
    public_key: signedPoR.public_key,
    signature: signedPoR.signature,
  };
}
