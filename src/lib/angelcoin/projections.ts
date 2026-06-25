import { AccessTier } from "@prisma/client";
import { computeBalances } from "@/lib/angelcoin/balances";
import { evaluateAccessTier } from "@/lib/angelcoin/access-tiers";
import type { AngelCoinAccountWithJournal } from "@/lib/angelcoin/ledger-service";

const TIER_STATUS_LABELS: Record<AccessTier, string> = {
  [AccessTier.FULL]: "active",
  [AccessTier.LIMITED]: "limited",
  [AccessTier.SANDBOXED]: "sandboxed",
  [AccessTier.SHELTERED]: "sheltered",
  [AccessTier.SUSPENDED]: "suspended",
};

/**
 * Builds the main Passport-facing read model from account + journal source.
 */
export function buildPassportReadModel(account: AngelCoinAccountWithJournal) {
  const balances = computeBalances(account.journal);
  const evaluation = evaluateAccessTier({
    availableBalance: balances.availableBalance,
    lockedBalance: balances.lockedBalance,
    creditState: account.creditState,
    adminOverrideTier: account.adminOverrideTier,
  });

  return {
    subjectCommitment: account.subjectCommitment,
    creditState: account.creditState,
    accessTier: evaluation.tier,
    accessReason: evaluation.reason,
    storedAccessTier: account.accessTier ?? null,
    adminOverrideTier: account.adminOverrideTier,
    balances,
    journalEntryCount: account.journal.length,
    updatedAt: account.updatedAt.toISOString(),
  };
}

/**
 * Builds the agent-facing read model from the same account + journal source.
 */
export function buildAgentReadModel(account: AngelCoinAccountWithJournal) {
  const passport = buildPassportReadModel(account);

  return {
    subjectCommitment: passport.subjectCommitment,
    availableBalance: passport.balances.availableBalance,
    lockedBalance: passport.balances.lockedBalance,
    accessTier: passport.accessTier,
    accessReason: passport.accessReason,
    storedAccessTier: passport.storedAccessTier,
    creditState: passport.creditState,
    statusLabel: TIER_STATUS_LABELS[passport.accessTier],
  };
}

/**
 * Builds compact live-status summary for API consumers.
 */
export function buildLiveStatus(account: AngelCoinAccountWithJournal) {
  const passport = buildPassportReadModel(account);

  return {
    subjectCommitment: passport.subjectCommitment,
    availableBalance: passport.balances.availableBalance,
    lockedBalance: passport.balances.lockedBalance,
    accessTier: passport.accessTier,
    accessReason: passport.accessReason,
    storedAccessTier: passport.storedAccessTier,
    creditState: passport.creditState,
    statusLabel: TIER_STATUS_LABELS[passport.accessTier],
    journalEntryCount: passport.journalEntryCount,
    asOf: passport.updatedAt,
  };
}
