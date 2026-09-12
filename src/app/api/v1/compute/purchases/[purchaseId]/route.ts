import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authorizeResource } from "@/lib/auth/authorize";
import {
  deliverCompute,
  releaseCompute,
  refundCompute,
  verifyDelivery,
  type LifecycleResult,
} from "@/lib/agent-economy/compute-marketplace";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

const STATUS_BY_CODE: Record<string, number> = {
  purchase_not_found: 404,
  not_provider: 403,
  not_party: 403,
  not_independent: 403,
  not_staked: 403,
  not_enrolled: 403,
  invalid_signature: 403,
  verification_rejected: 409,
  verification_approved: 409,
  no_deliverable: 409,
  invalid_state: 409,
  internal_error: 500,
};

/**
 * POST /api/v1/compute/purchases/[purchaseId] — escrow lifecycle.
 * Body: { action: "deliver" | "release" | "refund", deliverable_digest? }
 *   - deliver: provider marks the purchase DELIVERED.
 *   - release: buyer (or ISSUER) pays the provider.
 *   - refund:  buyer (or ISSUER) recalls funds and restores capacity.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ purchaseId: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`compute:lifecycle:${ip}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 60));
  }

  const { purchaseId } = await params;
  const purchase = await prisma.computePurchase.findUnique({ where: { purchaseId } });
  if (!purchase) {
    return NextResponse.json({ error: "Purchase not found" }, { status: 404, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE });
  }
  const action = String(body.action ?? "");

  if (action === "deliver") {
    const auth = await authorizeResource(request, { kind: "agent", id: purchase.providerCommitment });
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
    }
    const result = await deliverCompute({
      purchaseId,
      providerCommitment: purchase.providerCommitment,
      deliverableDigest: body.deliverable_digest != null ? String(body.deliverable_digest) : null,
    });
    return respond(result, NO_STORE);
  }

  if (action === "release" || action === "refund") {
    const auth = await authorizeResource(request, { kind: "agent", id: purchase.buyerCommitment });
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
    }
    const isIssuer = auth.role === "ISSUER";
    const result =
      action === "release"
        ? await releaseCompute({ purchaseId, actorCommitment: purchase.buyerCommitment, isIssuer })
        : await refundCompute({ purchaseId, actorCommitment: purchase.buyerCommitment, isIssuer });
    return respond(result, NO_STORE);
  }

  if (action === "verify") {
    // A staked, independent third-party verifier signs off on the deliverable.
    const verdict = String(body.verdict ?? "").toUpperCase();
    if (verdict !== "APPROVE" && verdict !== "REJECT") {
      return NextResponse.json({ error: "verdict must be APPROVE or REJECT" }, { status: 400, headers: NO_STORE });
    }
    const verifierCommitment = String(body.verifier_commitment ?? body.verifierCommitment ?? "");
    const auth = await authorizeResource(request, { kind: "agent", id: verifierCommitment });
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
    }
    const result = await verifyDelivery({
      purchaseId,
      verifierCommitment,
      verdict,
      signature: String(body.signature ?? ""),
    });
    return respond(result, NO_STORE);
  }

  return NextResponse.json(
    { error: "Unknown action. Use 'deliver', 'release', 'refund', or 'verify'." },
    { status: 400, headers: NO_STORE }
  );
}

function respond(result: LifecycleResult, headers: Record<string, string>) {
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, error_code: result.code },
      { status: STATUS_BY_CODE[result.code] ?? 400, headers }
    );
  }
  return NextResponse.json({ success: true, purchase_id: result.purchaseId, status: result.status }, { headers });
}
