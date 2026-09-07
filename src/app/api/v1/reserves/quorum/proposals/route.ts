import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { listQuorumProposals } from "@/lib/reserves/threshold-quorum";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reserves/quorum/proposals — Lists active threshold proposals and dead-man heartbeats.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:quorum:proposals:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.min(Number.parseInt(limitParam, 10), 100) : 10;

  try {
    const data = await listQuorumProposals(limit);

    return NextResponse.json(
      {
        success: true,
        count: data.proposals.length,
        proposals: data.proposals,
        surveillance: data.surveillance,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=15",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
