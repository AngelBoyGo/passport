/**
 * Autonomous Spend Policy service (Phase 32).
 *
 * Reads/writes an agent's spend policy and derives rolling spend from real `Engagement` rows
 * (hirer outflows), then evaluates a proposed spend. Kept separate from the pure evaluator so
 * the policy logic is testable without a DB.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { EngagementStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  evaluateSpend,
  normalizePolicy,
  dayStartMs,
  weekStartMs,
  type SpendDecision,
  type SpendPolicy,
} from "./spend-policy";

/** Engagement statuses that represent committed hirer spend (not CANCELLED). */
const COMMITTED_SPEND_STATUSES = [
  EngagementStatus.HELD,
  EngagementStatus.DELIVERED,
  EngagementStatus.PAID,
];

export interface SpendPolicyInput {
  enabled?: boolean;
  perTxMaxAngel?: number;
  dailyMaxAngel?: number;
  weeklyMaxAngel?: number;
  counterpartyAllowlist?: string[] | null;
  domainAllowlist?: string[] | null;
}

function rowToPolicy(row: {
  agentCommitment: string;
  enabled: boolean;
  perTxMaxAngel: number;
  dailyMaxAngel: number;
  weeklyMaxAngel: number;
  counterpartyAllowlist: unknown;
  domainAllowlist: unknown;
}): SpendPolicy {
  return normalizePolicy({
    agentCommitment: row.agentCommitment,
    enabled: row.enabled,
    perTxMaxAngel: row.perTxMaxAngel,
    dailyMaxAngel: row.dailyMaxAngel,
    weeklyMaxAngel: row.weeklyMaxAngel,
    counterpartyAllowlist: row.counterpartyAllowlist as any,
    domainAllowlist: row.domainAllowlist as any,
  });
}

/** Returns the agent's policy, or a permissive default when none has been set. */
export async function getSpendPolicy(commitment: string): Promise<SpendPolicy> {
  const agentCommitment = commitment.toLowerCase();
  const row = await prisma.agentSpendPolicy.findUnique({ where: { agentCommitment } });
  if (!row) return normalizePolicy({ agentCommitment });
  return rowToPolicy(row);
}

/** Creates or replaces an agent's spend policy (owner/ISSUER authorized at the route). */
export async function setSpendPolicy(
  commitment: string,
  input: SpendPolicyInput,
  updatedBy: string
): Promise<SpendPolicy> {
  const agentCommitment = commitment.toLowerCase();
  const normalized = normalizePolicy({ agentCommitment, ...input });

  const data = {
    enabled: normalized.enabled,
    perTxMaxAngel: normalized.perTxMaxAngel,
    dailyMaxAngel: normalized.dailyMaxAngel,
    weeklyMaxAngel: normalized.weeklyMaxAngel,
    counterpartyAllowlist: normalized.counterpartyAllowlist ?? undefined,
    domainAllowlist: normalized.domainAllowlist ?? undefined,
    updatedBy,
  };

  const row = await prisma.agentSpendPolicy.upsert({
    where: { agentCommitment },
    create: { agentCommitment, ...data },
    update: data,
  });
  return rowToPolicy(row);
}

/** Rolling committed spend for an agent (from Engagement outflows) within the current day/week. */
export async function getRollingSpend(
  commitment: string,
  now: Date = new Date()
): Promise<{ spentToday: number; spentThisWeek: number }> {
  const agentCommitment = commitment.toLowerCase();
  const dayStart = new Date(dayStartMs(now));
  const weekStart = new Date(weekStartMs(now));

  const rows = await prisma.engagement.findMany({
    where: {
      hirerCommitment: agentCommitment,
      status: { in: COMMITTED_SPEND_STATUSES },
      createdAt: { gte: weekStart },
    },
    select: { amount: true, createdAt: true },
  });

  let spentToday = 0;
  let spentThisWeek = 0;
  for (const r of rows) {
    spentThisWeek += r.amount;
    if (r.createdAt >= dayStart) spentToday += r.amount;
  }
  return { spentToday, spentThisWeek };
}

/** Full check: policy + rolling spend → decision. Used by value routes before committing spend. */
export async function checkSpendPolicy(input: {
  agentCommitment: string;
  amount: number;
  counterparty?: string | null;
  domain?: string | null;
  now?: Date;
}): Promise<SpendDecision> {
  const policy = await getSpendPolicy(input.agentCommitment);
  const { spentToday, spentThisWeek } = await getRollingSpend(input.agentCommitment, input.now);
  return evaluateSpend({
    policy,
    amount: input.amount,
    counterparty: input.counterparty,
    domain: input.domain,
    spentToday,
    spentThisWeek,
  });
}
