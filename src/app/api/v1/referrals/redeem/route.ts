import { NextRequest, NextResponse } from "next/server";
import { redeemReferralCode } from "@/lib/referral/referral-service";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/referrals/redeem — redeem a referral code for credits.
 * Body: { code: "ABC123" }
 * Rate-limited: 5 per IP per minute to prevent brute-force guessing.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`referral-redeem:${ip}`, 5, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSec ?? 60) } });
  }

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