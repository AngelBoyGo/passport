/**
 * Verifier reputation (Phase 36).
 *
 * Tracks how often a delivery verifier's signed verdict matched the purchase's eventual
 * outcome (APPROVE ↔ SETTLED, REJECT ↔ REFUNDED), so verifiers can be weighted by track record
 * rather than trusted blindly.
 */

import { prisma } from "@/lib/db";

/** Below this accuracy (with enough history) a verifier is treated as unreliable. */
export const MIN_VERIFIER_SAMPLE = 5;
export const MIN_VERIFIER_ACCURACY = 0.5;

export interface VerifierStats {
  verifierCommitment: string;
  verdicts: number;
  approvals: number;
  rejections: number;
  resolved: number;
  correct: number;
  /** correct / resolved, or null when the verifier has no resolved verdicts yet. */
  accuracy: number | null;
  reliable: boolean;
}

export async function computeVerifierStats(commitment: string): Promise<VerifierStats> {
  const verifierCommitment = commitment.toLowerCase();
  const rows = await prisma.computePurchase.findMany({
    where: { verifierCommitment, verificationVerdict: { not: null } },
    select: { verificationVerdict: true, status: true },
  });

  const approvals = rows.filter((r) => r.verificationVerdict === "APPROVE").length;
  const rejections = rows.filter((r) => r.verificationVerdict === "REJECT").length;

  let resolved = 0;
  let correct = 0;
  for (const r of rows) {
    if (r.verificationVerdict === "APPROVE" && r.status === "SETTLED") {
      resolved++;
      correct++;
    } else if (r.verificationVerdict === "REJECT" && r.status === "REFUNDED") {
      resolved++;
      correct++;
    } else if (r.status === "SETTLED" || r.status === "REFUNDED") {
      resolved++;
    }
  }

  const accuracy = resolved > 0 ? correct / resolved : null;
  const reliable =
    resolved < MIN_VERIFIER_SAMPLE || (accuracy !== null && accuracy >= MIN_VERIFIER_ACCURACY);

  return {
    verifierCommitment,
    verdicts: rows.length,
    approvals,
    rejections,
    resolved,
    correct,
    accuracy,
    reliable,
  };
}
