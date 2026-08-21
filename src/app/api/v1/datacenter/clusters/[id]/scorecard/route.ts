import { NextRequest, NextResponse } from "next/server";
import { getDataCenterScorecard } from "@/lib/datacenter/datacenter-service";
import { checkInMemoryRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`datacenter:scorecard:${ip}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 60));
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing cluster ID" }, { status: 400 });
  }

  const scorecard = await getDataCenterScorecard(id);

  return NextResponse.json(scorecard, {
    headers: {
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
