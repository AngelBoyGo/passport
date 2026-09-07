import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { submitQuorumSignature } from "@/lib/reserves/threshold-quorum";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/reserves/quorum/sign — Submit a Sovereign Ed25519 State Vote.
 *
 * Automatically executes the underlying action transition when distinct signatures
 * reach the required threshold (e.g. 2-of-3).
 *
 * Body:
 *   proposal_id: string
 *   signer_state: "ML" | "BF" | "NE"
 *   signature: string (Ed25519 hex over payloadDigest)
 *   signer_public_key?: string
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:quorum:sign:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const proposalId = String(body.proposal_id || body.proposalId || "");
  const signerState = String(body.signer_state || body.signerState || "");
  const signature = String(body.signature || "");
  const signerPublicKey = body.signer_public_key ? String(body.signer_public_key) : undefined;

  if (!proposalId || !signerState || !signature) {
    return NextResponse.json(
      { error: "proposal_id, signer_state, and signature are required" },
      { status: 400 }
    );
  }

  try {
    const result = await submitQuorumSignature({
      proposalId,
      signerState,
      signature,
      signerPublicKey,
    });

    return NextResponse.json(
      {
        success: true,
        proposal_id: result.proposalId,
        signer_state: result.signerState,
        total_signatures: result.totalSignatures,
        required_threshold: result.requiredThreshold,
        status: result.status,
        executed: result.executed,
        execution_result: result.executionResult,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
