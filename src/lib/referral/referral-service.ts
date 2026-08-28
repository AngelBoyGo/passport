import { prisma } from "@/lib/db";
import { bytesToHex } from "@noble/hashes/utils.js";

const REFERRAL_BONUS_CREDITS = Number(process.env.REFERRAL_BONUS_CREDITS) || 50;
const REFERRAL_CODE_LENGTH = 8;

/**
 * Generates a unique referral code for an operator.
 */
export async function generateReferralCode(operatorId: string): Promise<{ code: string; bonusCredits: number }> {
  const code = bytesToHex(crypto.getRandomValues(new Uint8Array(REFERRAL_CODE_LENGTH))).slice(0, REFERRAL_CODE_LENGTH);

  const existing = await prisma.referralCode.findUnique({ where: { operatorId } });
  if (existing) {
    return { code: existing.code, bonusCredits: existing.bonusCredits };
  }

  await prisma.referralCode.create({
    data: { operatorId, code, bonusCredits: REFERRAL_BONUS_CREDITS },
  });

  return { code, bonusCredits: REFERRAL_BONUS_CREDITS };
}

/**
 * Redeems a referral code for the referring operator. Grants bonus credits.
 */
export async function redeemReferralCode(code: string): Promise<{ operatorId: string; bonusCredits: number } | null> {
  const referral = await prisma.referralCode.findUnique({ where: { code } });
  if (!referral) return null;

  await prisma.$transaction(async (tx) => {
    await tx.referralCode.update({
      where: { id: referral.id },
      data: { totalUsed: referral.totalUsed + 1 },
    });
    await tx.operator.update({
      where: { id: referral.operatorId },
      data: { credits: { increment: referral.bonusCredits } },
    });
  });

  return { operatorId: referral.operatorId, bonusCredits: referral.bonusCredits };
}

/**
 * Gets referral code info for an operator.
 */
export async function getReferralCode(operatorId: string): Promise<{ code: string; totalUsed: number; bonusCredits: number } | null> {
  const referral = await prisma.referralCode.findUnique({ where: { operatorId } });
  if (!referral) return null;
  return { code: referral.code, totalUsed: referral.totalUsed, bonusCredits: referral.bonusCredits };
}