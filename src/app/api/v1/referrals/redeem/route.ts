import { NextRequest, NextResponse } from "next/server";
import { redeemReferralCode } from "@/lib/referral/referral-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/referrals/redeem — redeem a referral code for credits.
 * Body: { code: "ABC123" }
 */
export async function POST(request: NextRequest) {
  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.code || typeof body.code !== "string" || body.code.length < 4) {
    return NextResponse.json({ error: "Invalid referral code" }, { status: 400 });
  }

  const result = await redeemReferralCode(body.code.trim());
  if (!result) {
    return NextResponse.json({ error: "Referral code not found" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    bonus_credits: result.bonusCredits,
    message: `Referral redeemed! ${result.bonusCredits} credits awarded.`,
  });
}