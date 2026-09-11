import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { getExecutionSafetyFlag } from "@/lib/raillab/breach-response";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/raillab/health/safety — current execution-safety flag (public).
 * `halted: true` means the breach interlock has stopped ALL live settlement execution.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:safety:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const flag = await getExecutionSafetyFlag();
  return NextResponse.json(
    {
      success: true,
      safety: {
        halted: flag.halted,
        halted_at: flag.haltedAt ? flag.haltedAt.toISOString() : null,
        reason: flag.reason,
        caused_by_attestation_id: flag.causedByAttestationId,
        version: flag.version,
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=15",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}