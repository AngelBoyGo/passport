import { ErrorTranche } from "@prisma/client";

/** Minimum enterprise escrow floor — $50.00 */
export const MINIMUM_ESCROW_FLOOR_CENTS = 5000;

/** Variable liability tiers (cents). */
export const PENALTY_TIERS_CENTS: Partial<Record<ErrorTranche, number>> = {
  [ErrorTranche.DATA_LEAKAGE]: 10000,
  [ErrorTranche.LOGIC_DETECTION]: 2500,
  [ErrorTranche.COMPUTE_TIMEOUT]: 0,
};
