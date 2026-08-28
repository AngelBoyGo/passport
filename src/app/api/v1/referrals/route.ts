import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { generateReferralCode, getReferralCode } from "@/lib/referral/referral-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/referrals — get the operator's referral code.
 */
export async function GET(request: NextRequest) {
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
 */
export async function POST(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await generateReferralCode(session.operatorId);
  return NextResponse.json(result, { status: 201 });
}