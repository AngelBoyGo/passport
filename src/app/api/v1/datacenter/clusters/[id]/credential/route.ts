import { NextRequest, NextResponse } from "next/server";
import { generateDataCenterSustainabilityVC } from "@/lib/datacenter/datacenter-service";
import { checkInMemoryRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`datacenter:credential:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing cluster ID" }, { status: 400 });
  }

  const vc = await generateDataCenterSustainabilityVC(id);
  if (!vc) {
    return NextResponse.json({ error: "No data center telemetry records found" }, { status: 404 });
  }

  return NextResponse.json(vc, {
    headers: {
      "Content-Type": "application/vc+ld+json",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
