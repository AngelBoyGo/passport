/**
 * Think Tank Kernel — the reasoning engine of the autonomous agent economy.
 *
 * This is the brain. It ingests data from agent discoveries, market signals,
 * web searches, and internal metrics, then produces:
 *   - Opportunities: specific actions agents should take to generate value
 *   - Allocations: how many agent instances at what cost tier
 *   - Strategies: high-level approaches for the agent economy
 *   - Insights: patterns learned from accumulated memory
 *
 * The Kernel grows over time. Every analysis, every outcome, every failure
 * is stored as evidence on Passport — building an immutable, auditable,
 * and ever-improving strategic memory.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export type OpportunityType =
  | "data_pipeline"      // Transform public data into sellable assets
  | "arbitrage"          // Price differences across platforms
  | "content_generation" // SEO content, documentation, marketing
  | "verification"       // Agent work verification services
  | "trading"            // Token/asset trading strategies
  | "insider_research"   // Deep web research, trend analysis
  | "partnership"        // Cross-platform integration opportunities
  | "infrastructure"     // New agent capabilities to build
  | "governance"         // Protocol improvement proposals
  | "unknown";           // AI-classified novel opportunity

export type Confidence = "very_low" | "low" | "medium" | "high" | "very_high";
export type Urgency = "low" | "medium" | "high" | "critical";

export interface ThinkTankInput {
  /** Current system state */
  systemState: {
    totalAgents: number;
    activeAgents: number;
    totalSupply: number;
    totalStaked: number;
    revenue30d: number;
    cost30d: number;
    commodityReserve: number;
    avgAgentEarnings: number;
  };
  /** Recent discoveries from agents */
  discoveries: DiscoveryReport[];
  /** Recent market/economic signals */
  signals: MarketSignal[];
  /** Previous decisions and their outcomes */
  history: DecisionOutcome[];
  /** User-provided strategic goals */
  goals?: string[];
}

export interface DiscoveryReport {
  id: string;
  agentCommitment: string;
  title: string;
  description: string;
  valueEstimate: { min: number; max: number; currency: string };
  sourceUrls: string[];
  discoveredAt: string;
  tags: string[];
  evidenceHash: string;
}

export interface MarketSignal {
  type: string;
  source: string;
  value: number;
  description: string;
  timestamp: string;
}

export interface DecisionOutcome {
  decisionId: string;
  expectedValue: number;
  actualValue: number;
  success: boolean;
  lessonsLearned: string;
}

export interface ThinkTankOutput {
  /** When this analysis was produced */
  analyzedAt: string;
  /** Unique run ID */
  runId: string;
  /** Strategic recommendations */
  recommendations: Recommendation[];
  /** Agent instance allocation plan */
  allocation: AgentAllocation;
  /** Discovered opportunities ranked by expected value */
  opportunities: RankedOpportunity[];
  /** Key insights derived from accumulated memory */
  insights: string[];
  /** Self-assessment of this analysis quality */
  selfAssessment: {
    confidence: Confidence;
    dataQuality: "poor" | "fair" | "good" | "excellent";
    gaps: string[];
  };
}

export interface Recommendation {
  id: string;
  type: OpportunityType;
  title: string;
  description: string;
  expectedValue: number;
  expectedValueCurrency: string;
  confidence: Confidence;
  urgency: Urgency;
  timeHorizon: "immediate" | "short_term" | "medium_term" | "long_term";
  rationale: string;
  risks: string[];
  evidenceHash?: string;
}

export interface AgentAllocation {
  totalBudget: number;
  budgetCurrency: string;
  tiers: AllocationTier[];
  rationale: string;
}

export interface AllocationTier {
  instanceCount: number;
  costPerInstance: number;
  costCurrency: string;
  capability: string;
  expectedOutput: string;
}

export interface RankedOpportunity {
  rank: number;
  title: string;
  type: OpportunityType;
  expectedValue: number;
  confidence: Confidence;
  effort: "low" | "medium" | "high";
  timeToValue: string;
  description: string;
}

export interface ThinkTankMemory {
  /** All previous run IDs */
  runIds: string[];
  /** Best performing recommendations */
  topPerformers: Array<{ recommendationId: string; actualValue: number }>;
  /** Worst performing recommendations */
  worstPerformers: Array<{ recommendationId: string; actualValue: number }>;
  /** Accumulated lessons */
  lessons: string[];
  /** Strategy evolution */
  strategyEvolution: Array<{ runId: string; strategy: string; outcome: string }>;
}

// ── Pure functions: deterministic, no I/O ──

/**
 * Computes the think tank run ID from input hash.
 */
export function computeRunId(input: ThinkTankInput): string {
  const canonical = JSON.stringify(input, Object.keys(input).sort());
  return `tt_${bytesToHex(sha256(utf8ToBytes(canonical))).slice(0, 16)}`;
}

/**
 * Ranks opportunities by expected value × confidence.
 */
export function rankOpportunities(
  opportunities: RankedOpportunity[]
): RankedOpportunity[] {
  const confidenceWeight: Record<Confidence, number> = {
    very_low: 0.1, low: 0.3, medium: 0.5, high: 0.75, very_high: 0.95,
  };
  const effortPenalty: Record<string, number> = {
    low: 1.0, medium: 0.6, high: 0.3,
  };

  return [...opportunities]
    .map((o) => ({
      ...o,
      rank: 0, // Will be set after sort
      // Computed score for sorting only
      _score: o.expectedValue * (confidenceWeight[o.confidence] || 0.5) * (effortPenalty[o.effort] || 0.5),
    }))
    .sort((a, b) => b._score - a._score)
    .map((o, i) => ({ ...o, rank: i + 1 }));
}

/**
 * Determines the optimal agent allocation based on system state and opportunities.
 * This is the core economic calculation — X instances at $Y cost.
 */
export function computeOptimalAllocation(
  state: ThinkTankInput["systemState"],
  goals?: string[]
): AgentAllocation {
  const profitable = state.revenue30d > state.cost30d;
  const runway = state.commodityReserve / Math.max(state.cost30d, 1);

  let totalBudget: number;
  let tiers: AllocationTier[];

  if (profitable && runway > 3) {
    // Expand aggressively
    totalBudget = Math.min(state.revenue30d * 0.6, state.commodityReserve * 0.2);
    tiers = [
      { instanceCount: Math.ceil(totalBudget * 0.5 / 50), costPerInstance: 50, costCurrency: "USD", capability: "high_compute_llm", expectedOutput: "complex analysis, content generation, arbitrage" },
      { instanceCount: Math.ceil(totalBudget * 0.3 / 20), costPerInstance: 20, costCurrency: "USD", capability: "medium_compute_search", expectedOutput: "web search, data collection, monitoring" },
      { instanceCount: Math.ceil(totalBudget * 0.2 / 10), costPerInstance: 10, costCurrency: "USD", capability: "low_compute_discovery", expectedOutput: "trend scanning, opportunity identification" },
    ];
  } else if (runway > 1) {
    // Maintain with slight growth
    totalBudget = Math.min(state.revenue30d * 0.4, state.commodityReserve * 0.1);
    tiers = [
      { instanceCount: Math.ceil(totalBudget * 0.6 / 50), costPerInstance: 50, costCurrency: "USD", capability: "high_compute_llm", expectedOutput: "core analysis and content generation" },
      { instanceCount: Math.ceil(totalBudget * 0.4 / 20), costPerInstance: 20, costCurrency: "USD", capability: "medium_compute_search", expectedOutput: "market monitoring and data collection" },
    ];
  } else {
    // Conservative — preserve capital
    totalBudget = Math.min(state.revenue30d * 0.2, state.commodityReserve * 0.05);
    tiers = [
      { instanceCount: Math.ceil(totalBudget / 20), costPerInstance: 20, costCurrency: "USD", capability: "medium_compute_search", expectedOutput: "focused opportunity discovery" },
    ];
  }

  return {
    totalBudget: Math.max(totalBudget, 20),
    budgetCurrency: "USD",
    tiers,
    rationale: profitable
      ? `Profitable operation (${state.revenue30d} revenue vs ${state.cost30d} cost). Expanding to capture more value.`
      : `Not yet profitable. Focusing on high-value opportunities with minimal cost.`,
  };
}

/**
 * Extracts lessons from past decision outcomes.
 */
export function extractLessons(history: DecisionOutcome[]): string[] {
  const lessons: string[] = [];
  const successes = history.filter((h) => h.success);
  const failures = history.filter((h) => !h.success);

  if (failures.length > 0) {
    const avgLoss = failures.reduce((s, f) => s + Math.abs(f.actualValue - f.expectedValue), 0) / failures.length;
    lessons.push(`Average error on failed decisions: ${Math.round(avgLoss)}. Need better validation before acting.`);
  }

  if (successes.length > 0) {
    const avgGain = successes.reduce((s, f) => s + Math.abs(f.actualValue - f.expectedValue), 0) / successes.length;
    lessons.push(`Average outperformance on successful decisions: ${Math.round(avgGain)}. Patterns identified.`);
  }

  if (history.length >= 5) {
    const accuracy = successes.length / history.length;
    lessons.push(`Decision accuracy: ${Math.round(accuracy * 100)}%. ${accuracy > 0.7 ? 'Strategy is working.' : 'Need to adjust strategy.'}`);
  }

  return lessons;
}