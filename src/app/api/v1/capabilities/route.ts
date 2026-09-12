import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { discoverCapabilities } from "@/lib/agent-economy/capability-registry";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/capabilities — discovery: which agents offer a capability (public).
 * Query: capability?, active? (default true), limit? (1-200).
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`capabilities:discover:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { searchParams } = new URL(request.url);
  const capability = searchParams.get("capability") ?? undefined;
  const activeOnly = searchParams.get("active") !== "false";
  const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined;

  const results = await discoverCapabilities({
    capability,
    activeOnly,
    limit: Number.isFinite(limit) ? (limit as number) : undefined,
  });

  return NextResponse.json(
    {
      success: true,
      capability: capability ?? null,
      count: results.length,
      results: results.map((c) => ({
        agent_commitment: c.agentCommitment,
        capability: c.capability,
        description: c.description,
        version: c.version,
        endpoint_url: c.endpointUrl,
        price_angel: c.priceAngel,
        unit: c.unit,
        verified: c.verified,
        updated_at: c.updatedAt.toISOString(),
      })),
    },
    { headers: { "Cache-Control": "public, max-age=15", "Access-Control-Allow-Origin": "*" } }
  );
}
