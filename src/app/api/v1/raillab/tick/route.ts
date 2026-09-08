import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { runExecutionTick } from "@/lib/raillab/executor";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/raillab/tick — full execution + health tick.
 * Auth: ISSUER API key or SCHEDULER_SECRET (x-scheduler-secret header).
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:tick:${ip}`, 10, 60_000);
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
    const result = await runExecutionTick();
    return NextResponse.json({ success: true, ...result }, { status: 200, headers: NO_STORE });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}