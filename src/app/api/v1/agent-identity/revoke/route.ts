import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { setRevoked } from "@/lib/agent-identity/oidc";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/agent-identity/revoke
 *
 * Kill ONE agent's sign-ins without touching the owner or the owner's other
 * agents — the defining property of an agent ID ("revocation stops that one
 * agent and touches nothing of the owner's").
 *
 * Body: { agent_commitment }
 * Auth: the owner's operator API key, OR an owner browser session.
 */
export async function POST(request: NextRequest) {
  let body: { agent_commitment?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: NO_STORE });
  }
  const agentCommitment = String(body.agent_commitment || "").trim().toLowerCase();
  if (!agentCommitment) {
    return NextResponse.json({ error: "agent_commitment required" }, { status: 400, headers: NO_STORE });
  }

  // Auth: API key (operator) or session (owner in browser).
  let operatorId: string | null = null;
  const apiKeyOperator = await authenticateApiKey(request.headers.get("authorization"));
  if (apiKeyOperator) operatorId = apiKeyOperator.id;
  if (!operatorId) {
    const session = await sessionFromRequest(request).catch(() => null);
    operatorId = session?.operator?.id ?? null;
  }
  if (!operatorId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const owns = await prisma.agent.findFirst({
    where: { agentId: agentCommitment, operatorId },
    select: { id: true },
  });
  if (!owns) {
    return NextResponse.json({ error: "not_agent_owner" }, { status: 403, headers: NO_STORE });
  }

  await setRevoked(prisma as never, agentCommitment);
  return NextResponse.json({ ok: true, agent_commitment: agentCommitment, revoked: true }, { headers: NO_STORE });
}
