import { NextRequest, NextResponse } from "next/server";
import { getDataCenterDocumentationManifest } from "@/lib/datacenter/datacenter-service";
import { checkInMemoryRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
const CORS = { "Access-Control-Allow-Origin": "*" };

/**
 * GET /api/v1/datacenter/documentation — the "what Passport documents for this
 * facility" manifest: artifact list, telemetry ledger, compliance readiness,
 * sustainability summary, and audit anchors. The documentation surface that
 * lets an autonomous data center (millions of AI microactions/day) provide
 * verifiable documentation without any human reviewer.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`dc-docs:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  const { searchParams } = new URL(request.url);
  const facility = searchParams.get("facility") ?? "facility-cluster-01";
  const manifest = await getDataCenterDocumentationManifest(facility);

  return NextResponse.json(manifest, {
    headers: { "Cache-Control": "public, max-age=60", ...CORS },
  });
}