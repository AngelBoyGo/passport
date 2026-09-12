import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { computeVerifierStats } from "@/lib/agent-economy/verifier-reputation";

export const dynamic = "force-dynamic";

/** GET /api/v1/verifiers/[commitment] — a delivery verifier's track record (public). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ commitment: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`verifiers:get:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { commitment } = await params;
  const stats = await computeVerifierStats(commitment);
  return NextResponse.json(
    {
      success: true,
      verifier_commitment: stats.verifierCommitment,
      verdicts: stats.verdicts,
      approvals: stats.approvals,
      rejections: stats.rejections,
      resolved: stats.resolved,
      correct: stats.correct,
      accuracy: stats.accuracy,
      reliable: stats.reliable,
    },
    { headers: { "Cache-Control": "public, max-age=30", "Access-Control-Allow-Origin": "*" } }
  );
}
