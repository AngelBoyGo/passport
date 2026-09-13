import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { creditExternalRevenue } from "@/lib/agent-economy/revenue-bridge";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

const STATUS_BY_CODE: Record<string, number> = {
  invalid_commitment: 400,
  invalid_source: 400,
  invalid_ref: 400,
  invalid_amount: 400,
  invalid_signature: 401,
  not_configured: 503,
  agent_not_found: 404,
  below_floor: 400,
  internal_error: 500,
};

/**
 * POST /api/v1/agent-revenue — credit verified external USD revenue to an agent's ANGEL wallet.
 *
 * Auth: an ISSUER API key (trusted), OR an HMAC `x-revenue-signature` header computed by the
 * partner rail with REVENUE_BRIDGE_SECRET. Idempotent on `external_ref`.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`agent-revenue:credit:${ip}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 60));
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE });
  }

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  const trusted = Boolean(operator && operator.apiKeyRole !== "HOLDER");

  const result = await creditExternalRevenue(
    {
      agentCommitment: String(body.agent_commitment ?? body.agentCommitment ?? ""),
      source: String(body.source ?? ""),
      externalRef: String(body.external_ref ?? body.externalRef ?? ""),
      grossUsdCents: Number(body.gross_usd_cents ?? body.grossUsdCents),
      signature: request.headers.get("x-revenue-signature") ?? undefined,
      pipelineJobId: body.pipeline_job_id != null ? String(body.pipeline_job_id) : undefined,
    },
    { trusted }
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, error_code: result.code },
      { status: STATUS_BY_CODE[result.code] ?? 400, headers: NO_STORE }
    );
  }

  return NextResponse.json(
    {
      success: true,
      entry_id: result.entryId,
      external_ref: result.externalRef,
      gross_usd_cents: result.grossUsdCents,
      angel_credited: result.angelCredited,
      reserve_usd_added: result.reserveUsdAdded,
      deduped: result.deduped,
    },
    { status: result.deduped ? 200 : 201, headers: NO_STORE }
  );
}
