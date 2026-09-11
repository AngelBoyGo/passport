import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { buildLighthouse } from "@/lib/raillab/lighthouse";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/raillab/lighthouse — Adoption Lighthouse (ISSUER-auth).
 *
 * A signed, organic-only barometer of external adoption: level + trajectory (trend), with
 * self-generated rows (smoke harnesses, the adoption proof loop) excluded by documented
 * markers. Degrades gracefully — a DB failure returns 200 with `degraded:true` and reasons
 * rather than a 500 that hides what data we do have.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:lighthouse:${ip}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 60));
  }

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator || operator.apiKeyRole === "HOLDER") {
    return NextResponse.json(
      { error: "Unauthorized: ISSUER key required" },
      { status: 401 }
    );
  }

  const body = await buildLighthouse();
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
