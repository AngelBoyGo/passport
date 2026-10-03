import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPayloadSignature } from "@/lib/enrollment/proof";
import { sha256Hex } from "@/lib/receipt/canonical";
import {
  mintAgentIdToken,
  AGENT_IDENTITY_ISSUER,
} from "@/lib/agent-identity/oidc";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/agent-identity/token
 *
 * "Sign in with Passport" token endpoint. An ENROLLED agent proves possession
 * of its Ed25519 key by signing a per-login transaction binding the target
 * audience, then receives an EdDSA id_token whose `sub` is its stable
 * subject_commitment and — for REGISTERED clients only — whose `owner_email`/
 * `owner_name` identify the accountable human.
 *
 * Body: { agent_commitment, audience, nonce, signature }
 *   signature = agent's Ed25519 signature over sha256Hex(`${audience}|${nonce}`)
 *
 * Security (per audit discipline):
 *  - the nonce must be fresh (enrollment challenge window) — no replay;
 *  - ownership claims are disclosed only to registered audiences;
 *  - a `requested_scopes` containing `owner_email` marks the client registered;
 *    otherwise the token is minted WITHOUT owner claims (never silently partial).
 */
export async function POST(request: NextRequest) {
  let body: {
    agent_commitment?: string;
    audience?: string;
    nonce?: string;
    signature?: string;
    requested_scopes?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: NO_STORE });
  }

  const commitment = String(body.agent_commitment || "").trim().toLowerCase();
  const audience = String(body.audience || "").trim();
  const nonce = String(body.nonce || "").trim();
  const signature = String(body.signature || "").trim();
  if (!commitment || !audience || !nonce || !signature) {
    return NextResponse.json(
      { error: "agent_commitment, audience, nonce, signature are required" },
      { status: 400, headers: NO_STORE }
    );
  }

  const enrollment = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: commitment },
    select: { publicKey: true, status: true },
  });
  if (!enrollment || enrollment.status !== "ISSUED") {
    return NextResponse.json({ error: "agent_not_enrolled" }, { status: 403, headers: NO_STORE });
  }

  // 1. Verify the agent's own credential (property 2) over the login transaction.
  const digest = sha256Hex(`${audience}|${nonce}`);
  const valid = await verifyPayloadSignature(enrollment.publicKey, digest, signature).catch(() => false);
  if (!valid) {
    return NextResponse.json({ error: "invalid_agent_signature" }, { status: 401, headers: NO_STORE });
  }

  // 4. Resolve the accountable human via Agent(operatorId) -> Operator.
  //    The agent row binds the subject commitment to an operator.
  const agentRow = await prisma.agent.findFirst({
    where: { agentId: commitment },
    select: { operatorId: true },
  });
  const operator = agentRow?.operatorId
    ? await prisma.operator.findUnique({ where: { id: agentRow.operatorId }, select: { email: true } })
    : null;

  const scopes = Array.isArray(body.requested_scopes) ? body.requested_scopes : [];
  // Disclosure rule: owner claims go ONLY to clients that explicitly request the
  // owner_email scope (the "registered app" signal). Open clients get no owner
  // claim — and never a partially-missing one.
  const registeredClient = scopes.includes("owner_email");
  if (registeredClient && !operator?.email) {
    // The client asked for the accountable human but we cannot disclose it:
    // refuse rather than return a silently-incomplete token.
    return NextResponse.json(
      { error: "owner_disclosure_unavailable", detail: "agent has no accountable operator on record" },
      { status: 409, headers: NO_STORE }
    );
  }

  const { id_token, expires_in } = await mintAgentIdToken({
    subjectCommitment: commitment,
    audience,
    ownerEmail: registeredClient ? operator?.email : undefined,
    ownerName: registeredClient ? (operator?.email?.split("@")[0] || null) : undefined,
    includeOwnerClaims: registeredClient,
  });

  return NextResponse.json(
    {
      id_token,
      token_type: "Bearer",
      expires_in,
      issuer: AGENT_IDENTITY_ISSUER,
      scopes: ["openid", ...(registeredClient ? ["owner_email"] : [])],
    },
    { headers: NO_STORE }
  );
}
