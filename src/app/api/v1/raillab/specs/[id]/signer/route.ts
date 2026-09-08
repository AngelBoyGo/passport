import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { setRailSigner } from "@/lib/raillab/settlement";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/raillab/specs/[id]/signer — set a rail's authorized Ed25519 signer.
 * Auth: ISSUER API key (raillab_set_signer is audit-logged).
 * Body: { signer_commitment }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:signer:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
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
  const signerCommitment = String(
    body.signer_commitment || body.signerCommitment || ""
  ).trim();

  if (!signerCommitment) {
    return NextResponse.json(
      { error: "signer_commitment is required" },
      { status: 400, headers: NO_STORE }
    );
  }

  const { id } = await params;
  try {
    await setRailSigner(id, signerCommitment, operator.id);
    return NextResponse.json(
      { success: true, id, signer_commitment: signerCommitment },
      { status: 200, headers: NO_STORE }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE });
  }
}