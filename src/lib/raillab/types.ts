/**
 * Rail Factory shared types & enums (Phase 19).
 */

export const RAIL_CATEGORIES = [
  "PAYMENT",
  "AGRI",
  "ENERGY",
  "CORRIDOR",
  "AGENT_PAYROLL",
] as const;
export type RailCategory = (typeof RAIL_CATEGORIES)[number];

export const LEDGER_KINDS = ["ANGEL", "FRACTIONAL", "LP", "STATE"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const KYC_TIERS = ["NONE", "IDENTITY", "KYC1", "KYC2"] as const;
export type KycTier = (typeof KYC_TIERS)[number];

export const RAIL_STATES = [
  "PROPOSED",
  "PROVISIONED",
  "SMOKE_TESTED",
  "ENABLED",
  "QUARANTINED",
  "RETIRED",
] as const;
export type RailState = (typeof RAIL_STATES)[number];

/** Normalized discovery payload shared by all live sources before persistence. */
export interface CandidateInput {
  source: string;
  name: string;
  category: string;
  providerKey: string;
  ledgerKind: string;
  kycTier: string;
  feeBps: number;
  endpoints?: Record<string, unknown>;
  idempotencyKeyPath?: string;
  fxActor?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

export interface RailSpecShape {
  railKey: string;
  name: string;
  category: string;
  providerKey: string;
  ledgerKind: string;
  kycTier: string;
  feeBps: number;
  endpoints?: Record<string, unknown>;
  idempotencyKeyPath?: string;
  fxActor?: Record<string, unknown>;
  blueprintId?: string;
  authorCommitment: string;
}
