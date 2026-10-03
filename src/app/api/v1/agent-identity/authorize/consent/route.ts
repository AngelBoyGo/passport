import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";
import { newAuthCode, storeAuthCode } from "@/lib/agent-identity/oidc";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/agent-identity/authorize/consent
 *
 * OWNER-APPROVED hand-off (browser flow). The accountable human — signed in via
 * session cookie — approves an agent's sign-in for a given audience and scope
 * set. Passport mints a single-use, short-lived authorization code the agent/app
 * exchanges at /api/v1/agent-identity/token (grant_type=authorization_code).
 *
 * This mirrors the "hand the sign-in to your owner" path and is the ONLY place
 * owner claims originate in the browser flow — so a human, not the agent,
 * controls disclosure of their own identity.
 *
 * Body: { agent_commitment, audience, requested_scopes?: string[] }
 */
export async function POST(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  let body: { agent_commitment?: string; audience?: string; requested_scopes?: string[]; code_challenge?: string; code_challenge_method?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: NO_STORE });
  }

  const agentCommitment = String(body.agent_commitment || "").trim().toLowerCase();
  const audience = String(body.audience || "").trim();
  const scopes = Array.isArray(body.requested_scopes) ? body.requested_scopes : ["owner_email"];
  const codeChallenge = body.code_challenge ? String(body.code_challenge).trim() : null;
  const codeChallengeMethod = body.code_challenge_method ? String(body.code_challenge_method).trim() : null;
  if (codeChallengeMethod && codeChallengeMethod !== "S256") {
    return NextResponse.json({ error: "unsupported_code_challenge_method" }, { status: 400, headers: NO_STORE });
  }
  if (!agentCommitment || !audience) {
    return NextResponse.json({ error: "agent_commitment and audience required" }, { status: 400, headers: NO_STORE });
  }

  // The agent must be enrolled.
  const enrollment = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: agentCommitment },
    select: { status: true },
  });
  if (!enrollment || enrollment.status !== "ISSUED") {
    return NextResponse.json({ error: "agent_not_enrolled" }, { status: 403, headers: NO_STORE });
  }

  // Authorization: the consenting human must OWN the agent, or be an executive
  // admin acting on the owner's behalf.
  const operator = session.operator;
  const owns = await prisma.agent.findFirst({
    where: { agentId: agentCommitment, operatorId: operator.id },
    select: { id: true },
  });
  if (!owns && !isExecutiveAdmin(operator)) {
    return NextResponse.json({ error: "not_agent_owner" }, { status: 403, headers: NO_STORE });
  }

  const code = newAuthCode();
  await storeAuthCode(prisma as never, code, {
    agent_commitment: agentCommitment,
    audience,
    scopes,
    owner_email: operator.email ?? null,
    owner_name: operator.email ? operator.email.split("@")[0] : null,
    created_at: Math.floor(Date.now() / 1000),
    code_challenge: codeChallenge,
    code_challenge_method: codeChallenge ? (codeChallengeMethod || "S256") : null,
  });

  return NextResponse.json({ code, expires_in: 120 }, { headers: NO_STORE });
}
