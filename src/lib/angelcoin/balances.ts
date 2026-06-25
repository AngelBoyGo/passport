import { AngelCoinEntryType } from "@prisma/client";

export type BalanceEntry = {
  entryType: AngelCoinEntryType;
  amount: number;
};

export type AngelCoinBalances = {
  grantedBalance: number;
  earnedBalance: number;
  spentBalance: number;
  lockedBalance: number;
  availableBalance: number;
};

const EARNED_TYPES = new Set<AngelCoinEntryType>([
  AngelCoinEntryType.PEER_GIFT,
  AngelCoinEntryType.TASK_PAYMENT,
  AngelCoinEntryType.SAFETY_NET_TOPUP,
  AngelCoinEntryType.RECOVERY_AWARD,
]);

/**
 * Computes deterministic AngelCoin balances from append-only journal entries.
 */
export function computeBalances(entries: BalanceEntry[]): AngelCoinBalances {
  let grantedBalance = 0;
  let earnedBalance = 0;
  let spentBalance = 0;
  let lockTotal = 0;
  let unlockTotal = 0;
  let adjustmentTotal = 0;

  for (const entry of entries) {
    switch (entry.entryType) {
      case AngelCoinEntryType.OPERATOR_GRANT:
        grantedBalance += entry.amount;
        break;
      case AngelCoinEntryType.PEER_GIFT:
      case AngelCoinEntryType.TASK_PAYMENT:
      case AngelCoinEntryType.SAFETY_NET_TOPUP:
      case AngelCoinEntryType.RECOVERY_AWARD:
        if (EARNED_TYPES.has(entry.entryType)) {
          earnedBalance += entry.amount;
        }
        break;
      case AngelCoinEntryType.SPEND:
        spentBalance += entry.amount;
        break;
      case AngelCoinEntryType.LOCK:
        lockTotal += entry.amount;
        break;
      case AngelCoinEntryType.UNLOCK:
        unlockTotal += entry.amount;
        break;
      case AngelCoinEntryType.ADJUSTMENT:
        adjustmentTotal += entry.amount;
        break;
      default:
        break;
    }
  }

  const lockedBalance = Math.max(0, lockTotal - unlockTotal);
  const availableBalance =
    grantedBalance +
    earnedBalance -
    spentBalance -
    lockedBalance +
    adjustmentTotal;

  return {
    grantedBalance,
    earnedBalance,
    spentBalance,
    lockedBalance,
    availableBalance,
  };
}
