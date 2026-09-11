import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { clearHaltIfHealthy } from "@/lib/raillab/breach-response";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/raillab/health/safety/clear — manual halt-clear (ISSUER or SCHEDULER_SECRET).
 * Only clears when the LATEST attestation is ok:true AND newer than the halt.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:safety:clear:${ip}`, 10, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 10));
  }

  const authHeader = request.headers.get("authorization");
  const schedulerSecret = process.env.SCHEDULER_SECRET;
  const providedSecret = request.headers.get("x-scheduler-secret");

  let authorized = false;
  if (schedulerSecret && providedSecret === schedulerSecret) {
    authorized = true;
  } else {
    const operator = await authenticateApiKey(authHeader);
    authorized = Boolean(operator && operator.apiKeyRole !== "HOLDER");
  }
  if (!authorized) {
    return NextResponse.json(
      { error: "Unauthorized: ISSUER key or SCHEDULER_SECRET required" },
      { status: 401, headers: NO_STORE }
    );
  }

  try {
    const cleared = await clearHaltIfHealthy();
    return NextResponse.json(
      { success: true, cleared, message: cleared ? "execution halt cleared" : "halt not clearable (no healthy attestation newer than halt)" },
      { status: cleared ? 200 : 409, headers: NO_STORE }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}