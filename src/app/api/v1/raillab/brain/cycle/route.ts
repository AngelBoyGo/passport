import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { runBrainCycle } from "@/lib/brain/command-brain";
import { isSchedulerAuthorized } from "@/lib/scheduler/auth";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/raillab/brain/cycle — run one Command Brain cycle.
 * Auth: ISSUER API key or SCHEDULER_SECRET (x-scheduler-secret header).
 * Phase 40: secret comparison is timing-safe and fail-closed in production
 * via the shared isSchedulerAuthorized helper.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:brain:cycle:${ip}`, 10, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 10));
  }

  const authHeader = request.headers.get("authorization");
  const providedSecret = request.headers.get("x-scheduler-secret");

  let authorized = false;
  if (isSchedulerAuthorized(providedSecret, process.env.SCHEDULER_SECRET, process.env.NODE_ENV)) {
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
    const report = await runBrainCycle();
    return NextResponse.json({ success: true, ...report }, { status: 200, headers: NO_STORE });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}