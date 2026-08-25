import { prisma } from "@/lib/db";

/**
 * Custodial wallet mapping (Bridge). An operator (KYC'd human) owns a wallet;
 * an agent commitment may be bound to it so on-chain earnings are always
 * attributable to a verified operator. Agents never hold independent wallets.
 */

export const KYC_GATE_NEEDS_APPROVED = "Operator KYC must be APPROVED before agent wallet binding";

function kycEnforced(): boolean {
  // Withdrawal/KYC guard is enforced in live; sandbox defaults may allow
  // NOT_REQUIRED so integrations can be developed before full KYB.
  return process.env.ANGL_WITHDRAW_KYC_ONLY === "true" || process.env.BRIDGE_ENV === "live";
}

/** C1: idempotent operator wallet. */
export async function ensureOperatorWallet(operatorId: string) {
  const existing = await prisma.bridgeWallet.findUnique({
    where: { operatorId },
  });
  if (existing) return existing;

  return prisma.bridgeWallet.upsert({
    where: { operatorId },
    create: { operatorId, upstream: "bridge" },
    update: {},
  });
}

/** C2/C3: bind an agent commitment to its KYC-approved operator's wallet. */
export async function ensureAgentWallet(subjectCommitment: string, operatorId: string) {
  const operator = await prisma.operator.findUnique({
    where: { id: operatorId },
    select: { kycStatus: true },
  });
  if (!operator) {
    throw new Error("Operator not found");
  }

  if (operator.kycStatus === "PENDING" || operator.kycStatus === "REJECTED") {
    throw new Error(KYC_GATE_NEEDS_APPROVED);
  }
  // APPROVED passes; NOT_REQUIRED passes only when KYC is not enforced
  // (e.g. sandbox without ANGL_WITHDRAW_KYC_ONLY).
  if (operator.kycStatus !== "APPROVED" && kycEnforced()) {
    throw new Error(KYC_GATE_NEEDS_APPROVED);
  }

  const existing = await prisma.bridgeWallet.findUnique({
    where: { operatorId },
  });
  if (existing) {
    return prisma.bridgeWallet.update({
      where: { id: existing.id },
      data: { subjectCommitment },
    });
  }

  return prisma.bridgeWallet.upsert({
    where: { operatorId },
    create: { operatorId, subjectCommitment, upstream: "bridge" },
    update: { subjectCommitment },
  });
}

/** Resolve the wallet binding for a commitment (for withdrawals/escrow). */
export async function walletForCommitment(subjectCommitment: string) {
  return prisma.bridgeWallet.findFirst({
    where: { subjectCommitment },
  });
}