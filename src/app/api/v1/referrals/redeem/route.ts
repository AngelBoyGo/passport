import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { redeemReferralCode } from "@/lib/referral/referral-service";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/referrals/redeem — redeem a referral code for credits.
 * Body: { code: "ABC123" }
 * Auth (audit fix H4): requires a valid operator API key. Self-referral is
 * rejected and each code is lifetime-capped.
 */
export async function POST(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`referral-redeem:${operator.id ?? ip}`, 5, 60_000);
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

  const result = await redeemReferralCode(body.code.trim(), operator.id);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : result.reason === "capped" ? 409 : 403;
    const message = result.reason === "not_found"
      ? "Referral code not found"
      : result.reason === "self_referral"
        ? "You cannot redeem your own referral code"
        : "This referral code has reached its maximum uses";
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({
    success: true,
    bonus_credits: result.bonusCredits,
    message: `Referral redeemed! ${result.bonusCredits} credits awarded.`,
  });
}