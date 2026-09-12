import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { prisma } from "@/lib/db";
import {
  createCommodityEscrow,
  releaseEscrowOnAssay,
  refundEscrowOnTimeout,
  getEscrow,
} from "@/lib/reserves/rwa-escrow";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/reserves/escrow — create, release, or refund a bilateral RWA escrow.
 *
 * AUTHORIZATION: an escrow moves the buyer's locked ANGEL, so a HOLDER key may only create an
 * escrow it funds, and may only release/refund an escrow it is a party to. An ISSUER key may
 * act on any escrow (delegated/arbitration).
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
  const isIssuer = operator.apiKeyRole !== "HOLDER";
  const ownsCommitment = async (commitment: string): Promise<boolean> => {
    if (!commitment) return false;
    const owned = await prisma.agent.findFirst({
      where: { operatorId: operator.id, agentId: commitment },
      select: { id: true },
    });
    return Boolean(owned);
  };

  try {
    if (action === "create") {
      const buyerCommitment = String(body.buyer_commitment || body.buyerCommitment || "");
      if (!isIssuer && !(await ownsCommitment(buyerCommitment))) {
        return NextResponse.json(
          { error: "The authenticated operator does not own the buyer commitment" },
          { status: 403, headers: NO_STORE }
        );
      }
      const escrow = await createCommodityEscrow({
        escrowId,
        buyerCommitment,
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

    if (action === "release" || action === "refund") {
      // Caller must be a party to the escrow (buyer or seller) unless ISSUER.
      if (!isIssuer) {
        const existing = await getEscrow(escrowId);
        if (!existing) {
          return NextResponse.json({ error: "Escrow not found" }, { status: 404, headers: NO_STORE });
        }
        const party =
          (await ownsCommitment(existing.buyerCommitment)) ||
          (await ownsCommitment(existing.sellerCommitment));
        if (!party) {
          return NextResponse.json(
            { error: "The authenticated operator is not a party to this escrow" },
            { status: 403, headers: NO_STORE }
          );
        }
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
