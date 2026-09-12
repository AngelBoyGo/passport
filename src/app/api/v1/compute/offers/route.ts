import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authorizeResource } from "@/lib/auth/authorize";
import { createOffer, listOffers } from "@/lib/agent-economy/compute-marketplace";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * GET /api/v1/compute/offers — browse active compute offers (public).
 * POST /api/v1/compute/offers — create/refresh an offer (owner of provider_commitment).
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`compute:offers:get:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { searchParams } = new URL(request.url);
  const capability = searchParams.get("capability") ?? undefined;
  const activeOnly = searchParams.get("active") !== "false";
  const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined;

  const offers = await listOffers({
    capability,
    activeOnly,
    limit: Number.isFinite(limit) ? (limit as number) : undefined,
  });

  return NextResponse.json(
    {
      success: true,
      count: offers.length,
      offers: offers.map((o) => ({
        offer_id: o.offerId,
        provider_commitment: o.providerCommitment,
        capability: o.capability,
        description: o.description,
        unit: o.unit,
        price_angel_per_unit: o.priceAngelPerUnit,
        remaining_units: o.remainingUnits,
        capacity_units: o.capacityUnits,
        status: o.status,
        provider_reputation_score: o.provider_reputation_score,
        provider_reputation_tier: o.provider_reputation_tier,
      })),
    },
    { headers: { "Cache-Control": "public, max-age=15", "Access-Control-Allow-Origin": "*" } }
  );
}

export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`compute:offers:post:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE });
  }

  const providerCommitment = String(body.provider_commitment ?? body.providerCommitment ?? "");
  const auth = await authorizeResource(request, { kind: "agent", id: providerCommitment });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }

  try {
    const offer = await createOffer({
      offerId: String(body.offer_id ?? body.offerId ?? ""),
      providerCommitment,
      capability: String(body.capability ?? ""),
      description: body.description != null ? String(body.description) : null,
      unit: body.unit != null ? String(body.unit) : undefined,
      priceAngelPerUnit: Number(body.price_angel_per_unit ?? body.priceAngelPerUnit),
      capacityUnits: Number(body.capacity_units ?? body.capacityUnits),
    });
    return NextResponse.json(
      {
        success: true,
        offer: {
          offer_id: offer.offerId,
          provider_commitment: offer.providerCommitment,
          capability: offer.capability,
          price_angel_per_unit: offer.priceAngelPerUnit,
          capacity_units: offer.capacityUnits,
          remaining_units: offer.remainingUnits,
          status: offer.status,
        },
      },
      { status: 200, headers: NO_STORE }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid offer" },
      { status: 400, headers: NO_STORE }
    );
  }
}
