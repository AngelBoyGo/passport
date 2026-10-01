import { prisma } from "@/lib/db";
import { bytesToHex } from "@noble/hashes/utils.js";

const REFERRAL_BONUS_CREDITS = Number(process.env.REFERRAL_BONUS_CREDITS) || 50;
const REFERRAL_CODE_LENGTH = 8;
// Lifetime cap per code. Without this an operator could redeem their own code
// repeatedly to mint unlimited credits (audit fix H4).
const REFERRAL_MAX_USES = Number(process.env.REFERRAL_MAX_USES) || 10;

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

export type RedeemResult =
  | { ok: true; operatorId: string; bonusCredits: number }
  | { ok: false; reason: "not_found" | "self_referral" | "capped" };

/**
 * Redeems a referral code for the referring operator. Grants bonus credits.
 *
 * Security (audit fix H4): the redeemer must be an authenticated operator
 * distinct from the code's owner, and each code is capped at a lifetime max.
 * Previously this was unauthenticated and uncapped — an operator could redeem
 * their own code in a loop to mint unlimited credits.
 */
export async function redeemReferralCode(
  code: string,
  redeemerOperatorId: string
): Promise<RedeemResult> {
  const referral = await prisma.referralCode.findUnique({ where: { code } });
  if (!referral) return { ok: false, reason: "not_found" };
  if (referral.operatorId === redeemerOperatorId) return { ok: false, reason: "self_referral" };
  if (referral.totalUsed >= REFERRAL_MAX_USES) return { ok: false, reason: "capped" };

  // Atomic cap guard: only increment if still under the limit.
  const claimed = await prisma.referralCode.updateMany({
    where: { id: referral.id, totalUsed: { lt: REFERRAL_MAX_USES } },
    data: { totalUsed: { increment: 1 } },
  });
  if (claimed.count === 0) return { ok: false, reason: "capped" };

  await prisma.operator.update({
    where: { id: referral.operatorId },
    data: { credits: { increment: referral.bonusCredits } },
  });

  return { ok: true, operatorId: referral.operatorId, bonusCredits: referral.bonusCredits };
}

/**
 * Gets referral code info for an operator.
 */
export async function getReferralCode(operatorId: string): Promise<{ code: string; totalUsed: number; bonusCredits: number } | null> {
  const referral = await prisma.referralCode.findUnique({ where: { operatorId } });
  if (!referral) return null;
  return { code: referral.code, totalUsed: referral.totalUsed, bonusCredits: referral.bonusCredits };
}