import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { listAttestations } from "@/lib/raillab/attest";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/raillab/health/attestations?limit= — signed integrity attestation tail (public).
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:attestations:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? 50);

  const rows = await listAttestations(Number.isFinite(limit) ? Math.round(limit) : 50);
  return NextResponse.json(
    {
      success: true,
      attestations: rows.map((a) => ({
        attestation_id: a.attestationId,
        checked_at: a.checkedAt.toISOString(),
        ok: a.ok,
        supply_consistent: a.supplyConsistent,
        fractional_consistent: a.fractionalConsistent,
        lp_invariant_ok: a.lpInvariantOk,
        attestation_hash: a.attestationHash,
        prev_attestation_hash: a.prevAttestationHash,
        signature: a.signature,
        algorithm: a.algorithm,
      })),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=30",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}