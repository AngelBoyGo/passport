import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { buildEconomyHealth } from "@/lib/agent-economy/economy-health";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/raillab/economy-health — signed economy-health dashboard (ISSUER-auth).
 * External-vs-mint health and circulation velocity, computed from real rows and signed so a
 * third party can verify it offline.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:economy-health:${ip}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 60));
  }

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator || operator.apiKeyRole === "HOLDER") {
    return NextResponse.json({ error: "Unauthorized: ISSUER key required" }, { status: 401 });
  }

  const body = await buildEconomyHealth();
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": body.degraded ? "private, no-store, max-age=0" : "private, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}