import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { buildResilience, resilienceCacheControl } from "@/lib/raillab/resilience";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/raillab/resilience — Economic Resilience Report (ISSUER-auth).
 *
 * Stress-tests the LIVE economy against adversarial conditions (redemption run, oracle skew,
 * reserve shortfall, Sybil wash) and reports whether the sacred invariants survive. Signed like
 * the Lighthouse; degrades gracefully (200 + reasons) rather than hiding data.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:resilience:${ip}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 60));
  }

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator || operator.apiKeyRole === "HOLDER") {
    return NextResponse.json({ error: "Unauthorized: ISSUER key required" }, { status: 401 });
  }

  const body = await buildResilience();
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": resilienceCacheControl(
        body.resilience.degraded,
        body.resilience.summary.severity
      ),
      "Access-Control-Allow-Origin": "*",
    },
  });
}
