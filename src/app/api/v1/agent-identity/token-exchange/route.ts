import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";
import { mintAgentIdToken, AGENT_IDENTITY_ISSUER } from "@/lib/agent-identity/oidc";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/agent-identity/token-exchange  (RFC 8693 style)
 *
 * Delegated access: an OPERATOR holding a valid API key exchanges it for an
 * id_token that represents one of ITS agents acting on its behalf, scoped to an
 * audience. This is the Enterprise wedge — "let the agent act for the owner"
 * rather than "sign in as the owner".
 *
 * Body: { agent_commitment, audience, requested_scopes? }
 * Auth: Bearer operator API key.
 *
 * The operator may only mint a token for an agent it owns. The resulting token
 * carries `act` = the owner's operator id and (for owner_email scope) the owner
 * claims — the RFC 8693 "act" semantic for on-behalf-of delegation.
 */
export async function POST(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  let body: { agent_commitment?: string; audience?: string; requested_scopes?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: NO_STORE });
  }
  const agentCommitment = String(body.agent_commitment || "").trim().toLowerCase();
  const audience = String(body.audience || "").trim();
  if (!agentCommitment || !audience) {
    return NextResponse.json({ error: "agent_commitment and audience required" }, { status: 400, headers: NO_STORE });
  }

  // The operator must own the agent; ownership is the delegation grant.
  const owns = await prisma.agent.findFirst({
    where: { agentId: agentCommitment, operatorId: operator.id },
    select: { id: true },
  });
  if (!owns) {
    return NextResponse.json({ error: "not_agent_owner" }, { status: 403, headers: NO_STORE });
  }
  const enrollment = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: agentCommitment },
    select: { status: true },
  });
  if (!enrollment || enrollment.status !== "ISSUED") {
    return NextResponse.json({ error: "agent_not_enrolled" }, { status: 403, headers: NO_STORE });
  }

  const scopes = Array.isArray(body.requested_scopes) ? body.requested_scopes : [];
  const includeOwner = scopes.includes("owner_email");
  const { id_token, expires_in } = await mintAgentIdToken({
    subjectCommitment: agentCommitment,
    audience,
    ownerEmail: includeOwner ? operator.email ?? null : undefined,
    ownerName: includeOwner && operator.email ? operator.email.split("@")[0] : undefined,
    includeOwnerClaims: includeOwner,
  });

  return NextResponse.json(
    {
      id_token,
      issued_token_type: "urn:ietf:params:oauth:token-type:id_token",
      token_type: "Bearer",
      expires_in,
      issuer: AGENT_IDENTITY_ISSUER,
      // RFC 8693 "act": the agent is acting ON BEHALF OF this operator.
      act: { sub: operator.id },
      scopes: ["openid", ...(includeOwner ? ["owner_email"] : [])],
    },
    { headers: NO_STORE }
  );
}
