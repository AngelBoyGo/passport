import { NextRequest, NextResponse } from "next/server";
import { buildDataCenterCompliancePackage } from "@/lib/datacenter/datacenter-service";
import { checkInMemoryRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`datacenter:compliance:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing cluster ID" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const framework = (searchParams.get("framework") as any) || "EU_AI_ACT";

  const pkg = await buildDataCenterCompliancePackage(id, framework);
  if (!pkg) {
    return NextResponse.json({ error: "No data center records found" }, { status: 404 });
  }

  return NextResponse.json(pkg, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
