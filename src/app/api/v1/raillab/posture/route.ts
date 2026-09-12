import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { buildPosture, postureCacheControl } from "@/lib/raillab/posture";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/raillab/posture — Fail-Closed System Posture & Readiness (ISSUER-auth).
 *
 * Composes every assurance surface (attestation, safety interlock, console, lighthouse,
 * resilience) plus a deployment readiness check into one signed severity. Any unreadable or
 * unconfigured source forces >= WARNING; a failed hard check forces SEVERE. Never a 500 that
 * hides a degraded system.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:posture:${ip}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 60));
  }

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator || operator.apiKeyRole === "HOLDER") {
    return NextResponse.json({ error: "Unauthorized: ISSUER key required" }, { status: 401 });
  }

  const body = await buildPosture();
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": postureCacheControl(body.posture.degraded, body.posture.severity),
      "Access-Control-Allow-Origin": "*",
    },
  });
}