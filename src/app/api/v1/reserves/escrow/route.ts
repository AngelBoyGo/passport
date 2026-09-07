import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import {
  createCommodityEscrow,
  releaseEscrowOnAssay,
  refundEscrowOnTimeout,
  getEscrow,
} from "@/lib/reserves/rwa-escrow";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/reserves/escrow — create, release, or refund a bilateral RWA escrow.
 *
 * Body actions:
 *   { action: "create", escrow_id, buyer_commitment, seller_commitment, batch_number,
 *     fine_grams, unit_price_usd, locked_angel, commodity_type?, timeout_hours? }
 *   { action: "release", escrow_id, assay_certification_number, release_signature }
 *   { action: "refund", escrow_id }
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:escrow:post:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = String(body.action || "");
  const escrowId = String(body.escrow_id || body.escrowId || "");

  try {
    if (action === "create") {
      const escrow = await createCommodityEscrow({
        escrowId,
        buyerCommitment: String(body.buyer_commitment || body.buyerCommitment || ""),
        sellerCommitment: String(body.seller_commitment || body.sellerCommitment || ""),
        batchNumber: String(body.batch_number || body.batchNumber || ""),
        commodityType: body.commodity_type ? String(body.commodity_type) : undefined,
        fineGrams: Number(body.fine_grams ?? body.fineGrams),
        unitPriceUsd: Number(body.unit_price_usd ?? body.unitPriceUsd),
        lockedAngel: Number(body.locked_angel ?? body.lockedAngel),
        timeoutHours: body.timeout_hours ? Number(body.timeout_hours) : undefined,
      });
      return NextResponse.json({ success: true, escrow }, { status: 201 });
    }

    if (action === "release") {
      const escrow = await releaseEscrowOnAssay({
        escrowId,
        assayCertificationNumber: String(
          body.assay_certification_number || body.assayCertificationNumber || ""
        ),
        releaseSignature: String(body.release_signature || body.releaseSignature || ""),
      });
      return NextResponse.json({ success: true, escrow }, { status: 200 });
    }

    if (action === "refund") {
      const escrow = await refundEscrowOnTimeout(escrowId);
      return NextResponse.json({ success: true, escrow }, { status: 200 });
    }

    return NextResponse.json(
      { error: "Unknown action. Use 'create', 'release', or 'refund'." },
      { status: 400 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * GET /api/v1/reserves/escrow?escrow_id=... — query an escrow by id.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:escrow:get:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { searchParams } = new URL(request.url);
  const escrowId = searchParams.get("escrow_id") || searchParams.get("escrowId");

  if (!escrowId) {
    return NextResponse.json({ error: "escrow_id query parameter is required" }, { status: 400 });
  }

  const escrow = await getEscrow(escrowId);
  if (!escrow) {
    return NextResponse.json({ error: "Escrow not found" }, { status: 404 });
  }

  return NextResponse.json(
    { success: true, escrow },
    {
      headers: {
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
