import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { buildCommandCenterData } from "@/lib/brain/command-center-data";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * GET /api/v1/raillab/brain/command-center — the watch-the-AI-think surface (ISSUER-auth).
 * Data aggregation lives in src/lib/brain/command-center-data.ts (shared with the
 * executive admin console's session-gated endpoint).
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:brain:command-center:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator || operator.apiKeyRole === "HOLDER") {
    return NextResponse.json({ error: "Unauthorized: ISSUER key required" }, { status: 401, headers: NO_STORE });
  }

  const data = await buildCommandCenterData();
  return NextResponse.json({ success: true, ...data }, { headers: NO_STORE });
}