import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAgentIdToken } from "@/lib/agent-identity/oidc";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * GET /api/v1/agent-identity/userinfo — OIDC userinfo for a Passport id_token.
 * Returns `sub` (the stable agent subject) and, for tokens that carry them, the
 * accountable-owner claims. Owner claims are re-derived from the token, never
 * fabricated.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "missing_bearer_token" }, { status: 401, headers: NO_STORE });
  }
  const payload = await verifyAgentIdToken(token);
  if (!payload) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401, headers: NO_STORE });
  }
  const sub = String(payload.sub || "");
  const enrollment = sub
    ? await prisma.agentEnrollment.findUnique({
        where: { subjectCommitment: sub },
        select: { status: true },
      })
    : null;
  return NextResponse.json(
    {
      sub,
      agent_enrolled: enrollment?.status === "ISSUED",
      ...(Object.prototype.hasOwnProperty.call(payload, "owner_email")
        ? { owner_email: payload.owner_email, owner_name: payload.owner_name }
        : {}),
    },
    { headers: NO_STORE }
  );
}
