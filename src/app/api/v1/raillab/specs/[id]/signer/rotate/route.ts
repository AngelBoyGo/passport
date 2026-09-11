import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { prisma } from "@/lib/db";
import { rotateSignerKey } from "@/lib/raillab/breach-response";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/raillab/specs/[id]/signer/rotate — rotate a rail's signer key to a new era.
 * ISSUER-only, audit-logged. Old-era keys keep verifying historical settlements.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:signer:rotate:${ip}`, 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 20));
  }

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator || operator.apiKeyRole === "HOLDER") {
    return NextResponse.json(
      { error: "Unauthorized: ISSUER key required" },
      { status: 401, headers: NO_STORE }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const newPublicKey = String(body.new_public_key || body.newPublicKey || "").trim();
  if (!newPublicKey) {
    return NextResponse.json(
      { error: "new_public_key is required" },
      { status: 400, headers: NO_STORE }
    );
  }

  const { id } = await params;
  const spec = await prisma.railSpec.findUnique({ where: { id } });
  if (!spec) {
    return NextResponse.json({ error: "RailSpec not found" }, { status: 404, headers: NO_STORE });
  }

  try {
    const result = await rotateSignerKey(spec.railKey, newPublicKey, operator.id);
    return NextResponse.json(
      { success: true, rail_key: result.railKey, valid_until: result.validUntil?.toISOString() ?? null },
      { status: 200, headers: NO_STORE }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE });
  }
}