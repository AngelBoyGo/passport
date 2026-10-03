import { NextRequest, NextResponse } from "next/server";
import { sha256Hex } from "@/lib/receipt/canonical";
import { AGENT_IDENTITY_ISSUER, AGENT_IDENTITY_TTL_SECONDS } from "@/lib/agent-identity/oidc";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/agent-identity/authorize
 *
 * Step 1 of "Sign in with Passport". A relying app starts a sign-in for an
 * enrolled agent. We mint a fresh server nonce (anti-replay) and return the
 * exact transaction the agent must sign. The agent then posts to
 * /api/v1/agent-identity/token with the signature.
 *
 * Body: { agent_commitment, audience, redirect_uri? }
 */
export async function POST(request: NextRequest) {
  let body: { agent_commitment?: string; audience?: string; redirect_uri?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: NO_STORE });
  }
  const audience = String(body.audience || "").trim();
  const agentCommitment = String(body.agent_commitment || "").trim().toLowerCase();
  if (!audience || !agentCommitment) {
    return NextResponse.json({ error: "audience and agent_commitment required" }, { status: 400, headers: NO_STORE });
  }

  const nonce = sha256Hex(`${agentCommitment}:${audience}:${Date.now()}:${Math.random()}`).slice(0, 32);
  const digest = sha256Hex(`${audience}|${nonce}`);

  return NextResponse.json(
    {
      issuer: AGENT_IDENTITY_ISSUER,
      agent_commitment: agentCommitment,
      audience,
      nonce,
      // The agent signs THIS digest with its Ed25519 private key.
      transaction_digest: digest,
      instructions: "Sign sha256Hex(`audience|nonce`) with your agent key, then POST /api/v1/agent-identity/token {agent_commitment, audience, nonce, signature}.",
      expires_in: AGENT_IDENTITY_TTL_SECONDS,
    },
    { headers: NO_STORE }
  );
}
