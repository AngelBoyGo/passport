import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAgentIdToken, getRevokedBefore, isRevoked, AGENT_IDENTITY_ISSUER } from "@/lib/agent-identity/oidc";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/agent-identity/verify
 *
 * Verify an id_token minted by "Sign in with Passport" and return the stable
 * agent subject + accountable owner. This is the server-side check an app (or
 * another agent, via the MCP tool `passport_verify_agent`) runs before acting
 * on an agent's behalf. Enforces audience + revocation.
 *
 * Body: { id_token, audience? }
 */
export async function POST(request: NextRequest) {
  let body: { id_token?: string; audience?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: NO_STORE });
  }
  const idToken = String(body.id_token || "").trim();
  if (!idToken) {
    return NextResponse.json({ error: "id_token required" }, { status: 400, headers: NO_STORE });
  }
  const payload = await verifyAgentIdToken(idToken);
  if (!payload) {
    return NextResponse.json({ verified: false, error: "invalid_token" }, { status: 401, headers: NO_STORE });
  }
  // Audience check when the caller supplies one.
  if (body.audience && String(payload.aud) !== String(body.audience)) {
    return NextResponse.json({ verified: false, error: "audience_mismatch" }, { status: 401, headers: NO_STORE });
  }
  const sub = String(payload.sub || "");
  // Revocation check.
  const revokedBefore = await getRevokedBefore(prisma as never, sub).catch(() => null);
  if (isRevoked(typeof payload.iat === "number" ? payload.iat : undefined, revokedBefore)) {
    return NextResponse.json({ verified: false, error: "agent_revoked" }, { status: 401, headers: NO_STORE });
  }
  const enrollment = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: sub },
    select: { status: true },
  });
  return NextResponse.json(
    {
      verified: true,
      issuer: AGENT_IDENTITY_ISSUER,
      subject: sub,
      agent_enrolled: enrollment?.status === "ISSUED",
      audience: payload.aud,
      exp: payload.exp,
      ...(Object.prototype.hasOwnProperty.call(payload, "owner_email")
        ? { owner_email: payload.owner_email, owner_name: payload.owner_name }
        : {}),
    },
    { headers: NO_STORE }
  );
}
