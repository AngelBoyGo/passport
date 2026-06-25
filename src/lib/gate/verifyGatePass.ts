import { prisma } from "@/lib/db";
import { ErrorTranche, OperationalDomain } from "@prisma/client";
import { MINIMUM_ESCROW_FLOOR_CENTS } from "@/lib/escrow/constants";
import { computeDomainCommitment } from "@/lib/receipt/canonical";

export interface GateResult {
  allow_invocation: boolean;
  reason?: string;
}

const WINDOW = 20;
/** Operator-wide fetch cap when assembling a per-domain sliding window. */
export const GATE_WINDOW_SCAN_LIMIT = 200;
const FAILURE_THRESHOLD = 0.1;

/**
 * Evaluates whether an operator may invoke within a specific operational
 * domain, using a sliding window of its most recent receipts in that domain.
 */
export async function verifyGatePass(
  operatorId: string,
  domain: OperationalDomain
): Promise<GateResult> {
  const operator = await prisma.operator.findUnique({
    where: { id: operatorId },
    select: { stakeBalanceCents: true },
  });

  if (
    !operator ||
    operator.stakeBalanceCents < MINIMUM_ESCROW_FLOOR_CENTS
  ) {
    return { allow_invocation: false, reason: "INSUFFICIENT_ESCROW_BOND" };
  }

  const recent = await prisma.receipt.findMany({
    where: { operatorId },
    orderBy: { issuedAt: "desc" },
    take: GATE_WINDOW_SCAN_LIMIT,
    select: {
      errorTranche: true,
      domain: true,
      domainCommitment: true,
      blindSalt: true,
    },
  });

  const matched = recent
    .filter((row) => {
      if (row.blindSalt) {
        return (
          row.domainCommitment != null &&
          computeDomainCommitment(domain, row.blindSalt) === row.domainCommitment
        );
      }
      return row.domain === domain;
    })
    .slice(0, WINDOW);

  if (matched.length === 0) {
    return { allow_invocation: false, reason: "ZERO_TENANCY_REJECT" };
  }

  const errorCount = matched.filter(
    (r) => r.errorTranche != null && r.errorTranche !== ErrorTranche.NONE
  ).length;
  const failureRate = errorCount / matched.length;

  if (failureRate > FAILURE_THRESHOLD) {
    return { allow_invocation: false, reason: "SLA_BREACH_THRESHOLD_EXCEEDED" };
  }

  return { allow_invocation: true };
}
