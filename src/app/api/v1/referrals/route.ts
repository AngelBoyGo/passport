import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { generateReferralCode, getReferralCode } from "@/lib/referral/referral-service";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/referrals — get the operator's referral code.
 * Rate-limited: 10 per IP per minute.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`referrals:${ip}`, 10, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const referral = await getReferralCode(session.operatorId);
  if (referral) {
    return NextResponse.json(referral);
  }

  const created = await generateReferralCode(session.operatorId);
  return NextResponse.json(created);
}

/**
 * POST /api/v1/referrals — create or retrieve referral code.
 * Rate-limited: 5 per IP per minute.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`referrals-create:${ip}`, 5, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await generateReferralCode(session.operatorId);
  return NextResponse.json(result, { status: 201 });
}