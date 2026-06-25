import { ErrorTranche } from "@prisma/client";
import { PENALTY_TIERS_CENTS } from "./constants";

/**
 * Returns the configured penalty in cents for an error tranche.
 */
export function getPenaltyForTranche(tranche: ErrorTranche): number {
  return PENALTY_TIERS_CENTS[tranche] ?? 0;
}

/**
 * Whether slashing should run on finalize for this outcome.
 */
export function shouldApplySlashing(
  status: string,
  tranche: ErrorTranche | undefined | null
): boolean {
  if (status === "success") return false;
  if (tranche == null || tranche === ErrorTranche.NONE) return false;
  return true;
}
