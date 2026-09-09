import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { getLatestAttestation } from "@/lib/raillab/attest";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/raillab/health/attestations/latest — latest signed integrity attestation (public).
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:attestations:latest:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const row = await getLatestAttestation();
  if (!row) {
    return NextResponse.json({ success: true, attestation: null }, { status: 200 });
  }

  return NextResponse.json(
    {
      success: true,
      attestation: {
        attestation_id: row.attestationId,
        checked_at: row.checkedAt.toISOString(),
        ok: row.ok,
        supply_consistent: row.supplyConsistent,
        fractional_consistent: row.fractionalConsistent,
        lp_invariant_ok: row.lpInvariantOk,
        pending_review_stale: row.pendingReviewStale,
        settled_total_credited: row.settledTotalCredited,
        settled_total_rows: row.settledTotalRows,
        issues: row.issues,
        prev_attestation_hash: row.prevAttestationHash,
        attestation_hash: row.attestationHash,
        signature: row.signature,
        public_key: undefined,
        algorithm: row.algorithm,
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=30",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}