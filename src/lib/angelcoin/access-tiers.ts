import {
  AccessTier,
  AngelCoinCreditState,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeBalances } from "@/lib/angelcoin/balances";
import {
  AngelCoinAccountNotFoundError,
  InvalidAgentCommitmentError,
} from "@/lib/angelcoin/errors";
import {
  assertValidSubjectCommitment,
  loadAccountWithJournal,
} from "@/lib/angelcoin/ledger-service";

export const LIMITED_THRESHOLD = 50;
export const SANDBOX_THRESHOLD = 10;

export type AccessTierInput = {
  availableBalance: number;
  lockedBalance: number;
  creditState: AngelCoinCreditState;
  adminOverrideTier: AccessTier | null;
};

export type AccessTierEvaluation = {
  tier: AccessTier;
  reason: string;
};

/**
 * Deterministically evaluates access tier from balance and account state.
 */
export function evaluateAccessTier(input: AccessTierInput): AccessTierEvaluation {
  if (input.adminOverrideTier != null) {
    return { tier: input.adminOverrideTier, reason: "admin_override" };
  }

  if (input.creditState === AngelCoinCreditState.INACTIVE) {
    return { tier: AccessTier.SUSPENDED, reason: "credit_inactive" };
  }

  if (input.availableBalance <= 0) {
    return { tier: AccessTier.SHELTERED, reason: "safety_net_floor" };
  }

  if (input.availableBalance < SANDBOX_THRESHOLD) {
    return { tier: AccessTier.SANDBOXED, reason: "low_balance_sandbox" };
  }

  if (input.availableBalance < LIMITED_THRESHOLD) {
    return { tier: AccessTier.LIMITED, reason: "low_balance_limited" };
  }

  return { tier: AccessTier.FULL, reason: "sufficient_balance" };
}

/**
 * Recomputes and persists access tier for a subject commitment.
 */
export async function applyAccessEvaluation(subjectCommitment: string) {
  assertValidSubjectCommitment(subjectCommitment);

  const account = await loadAccountWithJournal(subjectCommitment);
  if (!account) {
    throw new AngelCoinAccountNotFoundError();
  }

  const balances = computeBalances(account.journal);
  const evaluation = evaluateAccessTier({
    availableBalance: balances.availableBalance,
    lockedBalance: balances.lockedBalance,
    creditState: account.creditState,
    adminOverrideTier: account.adminOverrideTier,
  });

  const updated = await prisma.angelCoinAccount.update({
    where: { subjectCommitment },
    data: { accessTier: evaluation.tier },
  });

  return {
    account: updated,
    balances,
    evaluation,
  };
}

/**
 * Sets or clears admin override tier and re-evaluates access.
 */
export async function setAdminOverride(
  subjectCommitment: string,
  tier: AccessTier | null
) {
  assertValidSubjectCommitment(subjectCommitment);

  const existing = await prisma.angelCoinAccount.findUnique({
    where: { subjectCommitment },
  });
  if (!existing) {
    throw new AngelCoinAccountNotFoundError();
  }

  await prisma.angelCoinAccount.update({
    where: { subjectCommitment },
    data: { adminOverrideTier: tier },
  });

  return applyAccessEvaluation(subjectCommitment);
}

/**
 * Returns current access tier evaluation without persisting.
 */
export async function getAccessTierEvaluation(subjectCommitment: string) {
  assertValidSubjectCommitment(subjectCommitment);

  const account = await loadAccountWithJournal(subjectCommitment);
  if (!account) {
    throw new AngelCoinAccountNotFoundError();
  }

  const balances = computeBalances(account.journal);
  const evaluation = evaluateAccessTier({
    availableBalance: balances.availableBalance,
    lockedBalance: balances.lockedBalance,
    creditState: account.creditState,
    adminOverrideTier: account.adminOverrideTier,
  });

  return {
    account,
    balances,
    evaluation,
  };
}

export { InvalidAgentCommitmentError };
