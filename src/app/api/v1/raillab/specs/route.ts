import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { provisionAdoptionCanary } from "@/lib/raillab/factory-agent";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/raillab/specs — list rail specs, filter by state / category.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:specs:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { searchParams } = new URL(request.url);
  const state = searchParams.get("state");
  const category = searchParams.get("category");

  const where: Record<string, unknown> = {};
  if (state) where.state = state.toUpperCase();
  if (category) where.category = category.toUpperCase();

  const specs = await prisma.railSpec.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json(
    {
      success: true,
      specs: specs.map((s) => ({
        id: s.id,
        rail_key: s.railKey,
        name: s.name,
        category: s.category,
        provider_key: s.providerKey,
        ledger_kind: s.ledgerKind,
        kyc_tier: s.kycTier,
        fee_bps: s.feeBps,
        state: s.state,
        blueprint_id: s.blueprintId,
        author_commitment: s.authorCommitment,
        authorized_by: s.authorizedBy,
        version: s.version,
        created_at: s.createdAt.toISOString(),
      })),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=15",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

/**
 * POST /api/v1/raillab/specs — provision an ENABLED, caller-owned adoption canary rail.
 *
 * The Phase-26 adoption proof loop needs a rail it can settle with a signature it controls.
 * This ISSUER-only route provisions such a rail (idempotent on rail_key): the canary is
 * dry-run-safe by construction (no sandbox endpoint → canExecuteLive=false), so the caller
 * proves the full /settle signature-gated flow WITHOUT any rail ever moving live money.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:specs:post:${ip}`, 15, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 15));
  }

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator || operator.apiKeyRole === "HOLDER") {
    return NextResponse.json(
      { error: "Unauthorized: ISSUER key required" },
      { status: 401 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const railKey = String(body.rail_key || body.railKey || "").trim();
  const name = String(body.name || "Adoption Canary").trim();
  const category = String(body.category || "PAYMENT").toUpperCase();
  const providerKey = String(body.provider_key || body.providerKey || "agent_api").toLowerCase();
  const kycTier = String(body.kyc_tier || body.kycTier || "NONE").toUpperCase();
  const feeBps = Math.max(0, Number(body.fee_bps ?? body.feeBps ?? 0));
  const signerCommitment = String(body.signer_commitment || body.signerCommitment || "").trim().toLowerCase();

  if (!railKey || !/^[a-z0-9._-]{1,64}$/i.test(railKey)) {
    return NextResponse.json(
      { error: "rail_key must be a simple railway slug (letters/digits/._-)" },
      { status: 400 }
    );
  }
  if (!signerCommitment || !/^[0-9a-f]{64}$/i.test(signerCommitment)) {
    return NextResponse.json(
      { error: "signer_commitment must be a 64-hex Ed25519 public key the caller holds the private key for" },
      { status: 400 }
    );
  }

  try {
    const result = await provisionAdoptionCanary({
      railKey,
      name,
      category,
      providerKey,
      kycTier,
      feeBps,
      signerCommitment,
      authorizedBy: operator.id,
    });
    return NextResponse.json(
      { success: true, id: result.id, rail_key: result.railKey, state: result.state },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}