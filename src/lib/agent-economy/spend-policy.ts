/**
 * Autonomous Spend Policy (Phase 32).
 *
 * The Agent Wallet is the "liberation layer": agents transact without human approval. But
 * unattended autonomy needs a leash that is SET ONCE and enforced by code on every spend — or a
 * compromised/faulty agent can be drained. A spend policy is that leash: hard caps per
 * transaction and per rolling day/week, plus optional counterparty/domain allowlists.
 *
 * This module is the pure evaluator. It is deliberately deterministic and side-effect free so
 * the exact same decision can be reproduced and audited.
 */

export interface SpendPolicy {
  agentCommitment: string;
  enabled: boolean;
  /** Max ANGEL per single transaction. 0 = no cap. */
  perTxMaxAngel: number;
  /** Max ANGEL per rolling 24h. 0 = no cap. */
  dailyMaxAngel: number;
  /** Max ANGEL per rolling 7d. 0 = no cap. */
  weeklyMaxAngel: number;
  /** If non-empty, the counterparty commitment MUST be in this list. */
  counterpartyAllowlist: string[] | null;
  /** If non-empty, the spend domain MUST be in this list. */
  domainAllowlist: string[] | null;
}

export type SpendDenyCode =
  | "policy_disabled"
  | "invalid_amount"
  | "per_tx_exceeded"
  | "daily_exceeded"
  | "weekly_exceeded"
  | "counterparty_not_allowed"
  | "domain_not_allowed";

export interface SpendDecision {
  allowed: boolean;
  code?: SpendDenyCode;
  reason?: string;
  remainingDaily?: number;
  remainingWeekly?: number;
}

export const DEFAULT_SPEND_POLICY: Omit<SpendPolicy, "agentCommitment"> = {
  enabled: true,
  perTxMaxAngel: 0,
  dailyMaxAngel: 0,
  weeklyMaxAngel: 0,
  counterpartyAllowlist: null,
  domainAllowlist: null,
};

function asNonNegativeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const arr = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return arr.length > 0 ? arr : null;
}

/** Defensively coerces an untrusted/DB policy into a well-formed SpendPolicy. */
export function normalizePolicy(
  raw: Partial<SpendPolicy> & { agentCommitment: string }
): SpendPolicy {
  return {
    agentCommitment: raw.agentCommitment,
    enabled: raw.enabled !== false,
    perTxMaxAngel: asNonNegativeInt(raw.perTxMaxAngel),
    dailyMaxAngel: asNonNegativeInt(raw.dailyMaxAngel),
    weeklyMaxAngel: asNonNegativeInt(raw.weeklyMaxAngel),
    counterpartyAllowlist: asStringArray(raw.counterpartyAllowlist),
    domainAllowlist: asStringArray(raw.domainAllowlist),
  };
}

/** UTC midnight at the start of the rolling day. */
export function dayStartMs(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** UTC midnight at the start of the rolling week (week starts Monday, matching ISO). */
export function weekStartMs(now: Date): number {
  const d = new Date(dayStartMs(now));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (dayNum - 1));
  return d.getTime();
}

export interface EvaluateSpendInput {
  policy: SpendPolicy;
  amount: number;
  counterparty?: string | null;
  domain?: string | null;
  /** ANGEL already spent in the current rolling day / week (excluding this spend). */
  spentToday: number;
  spentThisWeek: number;
}

/**
 * Evaluates a proposed spend against a policy. Order matters: the most fundamental checks
 * (disabled, invalid amount, per-tx cap) come before the rolling-window checks.
 */
export function evaluateSpend(input: EvaluateSpendInput): SpendDecision {
  const { policy } = input;
  const amount = input.amount;

  if (!Number.isFinite(amount) || amount <= 0) {
    return { allowed: false, code: "invalid_amount", reason: "amount must be a positive number" };
  }
  if (!policy.enabled) {
    return { allowed: false, code: "policy_disabled", reason: "spending is disabled for this agent" };
  }
  if (policy.perTxMaxAngel > 0 && amount > policy.perTxMaxAngel) {
    return {
      allowed: false,
      code: "per_tx_exceeded",
      reason: `amount ${amount} exceeds the per-transaction cap of ${policy.perTxMaxAngel} ANGEL`,
    };
  }

  const spentToday = Math.max(0, input.spentToday);
  const spentThisWeek = Math.max(0, input.spentThisWeek);

  if (policy.dailyMaxAngel > 0 && spentToday + amount > policy.dailyMaxAngel) {
    return {
      allowed: false,
      code: "daily_exceeded",
      reason: `spend would exceed the daily cap (${spentToday + amount} > ${policy.dailyMaxAngel} ANGEL)`,
      remainingDaily: Math.max(0, policy.dailyMaxAngel - spentToday),
    };
  }
  if (policy.weeklyMaxAngel > 0 && spentThisWeek + amount > policy.weeklyMaxAngel) {
    return {
      allowed: false,
      code: "weekly_exceeded",
      reason: `spend would exceed the weekly cap (${spentThisWeek + amount} > ${policy.weeklyMaxAngel} ANGEL)`,
      remainingWeekly: Math.max(0, policy.weeklyMaxAngel - spentThisWeek),
    };
  }

  if (policy.counterpartyAllowlist) {
    const cp = (input.counterparty ?? "").toLowerCase();
    if (!cp || !policy.counterpartyAllowlist.map((c) => c.toLowerCase()).includes(cp)) {
      return {
        allowed: false,
        code: "counterparty_not_allowed",
        reason: "counterparty is not on the agent's allowlist",
      };
    }
  }
  if (policy.domainAllowlist) {
    const domain = (input.domain ?? "").trim().toLowerCase();
    if (!domain || !policy.domainAllowlist.map((d) => d.toLowerCase()).includes(domain)) {
      return {
        allowed: false,
        code: "domain_not_allowed",
        reason: "domain is not on the agent's allowlist",
      };
    }
  }

  return {
    allowed: true,
    remainingDaily: policy.dailyMaxAngel > 0 ? Math.max(0, policy.dailyMaxAngel - spentToday - amount) : undefined,
    remainingWeekly:
      policy.weeklyMaxAngel > 0 ? Math.max(0, policy.weeklyMaxAngel - spentThisWeek - amount) : undefined,
  };
}
