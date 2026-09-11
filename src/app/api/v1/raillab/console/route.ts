import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { buildTrustConsole } from "@/lib/raillab/console";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/raillab/console — Operational Trust Console (ISSUER-auth).
 * Aggregates safety interlock, latest signed attestation (offline-verified), and rail health
 * with a severity tilt. SEVERE states are never cached so agents always see the current halt.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:console:${ip}`, 60, 60_000);
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

  const console = await buildTrustConsole();
  // Emit snake_case API contract.
  const body = {
    success: true,
    console: {
      safety: {
        halted: console.safety.halted,
        halted_at: console.safety.haltedAt,
        reason: console.safety.reason,
        caused_by_attestation_id: console.safety.causedByAttestationId,
        version: console.safety.version,
      },
      attestation: {
        verified: console.attestation.verified,
        chain_ok: console.attestation.chainOk,
        prev_linked: console.attestation.prevLinked,
        issues: console.attestation.issues,
      },
      rails: {
        total: console.rails.total,
        enabled: console.rails.enabled,
        quarantined: console.rails.quarantined,
        by_kind: console.rails.byKind,
        velocity_alerts: console.rails.velocityAlerts,
        pending_review_stale: console.rails.pendingReviewStale,
      },
      severity: console.severity,
      generated_at: console.generatedAt,
    },
  };
  return NextResponse.json(
    body,
    {
      headers: {
        "Cache-Control": console.cacheControl,
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}