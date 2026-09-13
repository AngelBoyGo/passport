import { NextRequest, NextResponse } from "next/server";
import { bytesToHex } from "@noble/hashes/utils.js";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authorizeResource, verifyAgentIntent } from "@/lib/auth/authorize";
import { purchaseUnits } from "@/lib/agent-economy/compute-marketplace";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

const STATUS_BY_CODE: Record<string, number> = {
  offer_not_found: 404,
  offer_not_active: 409,
  insufficient_capacity: 409,
  spend_policy_denied: 403,
  insufficient_balance: 402,
  self_purchase: 400,
  invalid_units: 400,
  internal_error: 500,
};

/**
 * POST /api/v1/compute/offers/[offerId]/purchase — buy metered units with ANGEL.
 * Body: { buyer_commitment, units, purchase_id? }. Owner of buyer_commitment. Spend-policy gated.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ offerId: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`compute:purchase:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE });
  }

  const buyerCommitment = String(body.buyer_commitment ?? body.buyerCommitment ?? "");
  const auth = await authorizeResource(request, { kind: "agent", id: buyerCommitment });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }

  const { offerId } = await params;

  // A HOLDER key must also prove the AGENT authorised this exact purchase (signed intent) —
  // so a leaked operator key alone cannot spend the agent's ANGEL.
  if (auth.role === "HOLDER") {
    const intent = await verifyAgentIntent({
      intent: body.intent,
      expectAction: "compute.purchase",
      expectResource: { kind: "agent", id: buyerCommitment },
      expectParams: { offer_id: offerId, units: Number(body.units) },
    });
    if (!intent.ok) {
      return NextResponse.json({ error: intent.error }, { status: intent.status, headers: NO_STORE });
    }
  }

  const purchaseId =
    (body.purchase_id ? String(body.purchase_id) : "") || `cp_${bytesToHex(crypto.getRandomValues(new Uint8Array(8)))}`;

  const result = await purchaseUnits({
    offerId,
    buyerCommitment,
    units: Number(body.units),
    purchaseId,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, error_code: result.code },
      { status: STATUS_BY_CODE[result.code] ?? 400, headers: NO_STORE }
    );
  }

  return NextResponse.json(
    {
      success: true,
      purchase_id: result.purchaseId,
      offer_id: offerId,
      buyer_commitment: buyerCommitment,
      provider_commitment: result.providerCommitment,
      units: result.units,
      total_angel: result.totalAngel,
      status: result.status,
      deduped: result.deduped,
      escrow: "Funds are HELD until you release (or refund) the purchase.",
    },
    { status: 201, headers: NO_STORE }
  );
}
