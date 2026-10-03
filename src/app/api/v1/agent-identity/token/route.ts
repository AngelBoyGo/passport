import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPayloadSignature } from "@/lib/enrollment/proof";
import { sha256Hex } from "@/lib/receipt/canonical";
import {
  mintAgentIdToken,
  AGENT_IDENTITY_ISSUER,
  consumeAuthCode,
  verifyPkceS256,
  getRevokedBefore,
  isRevoked,
} from "@/lib/agent-identity/oidc";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/agent-identity/token
 *
 * "Sign in with Passport" token endpoint. Two grant shapes:
 *
 *  A. HEADLESS (agent-held key): { agent_commitment, audience, nonce, signature }
 *     The agent proves possession of its Ed25519 key over a per-login
 *     transaction.
 *
 *  B. OWNER-APPROVED (browser hand-off): { grant_type: "authorization_code",
 *     code, audience }
 *     The owner approved the sign-in in the browser; the single-use code was
 *     minted by /api/v1/agent-identity/authorize/consent.
 *
 * Both mint the same EdDSA id_token: `sub` = stable subject, and — for
 * registered clients only — accountable-owner claims.
 */
export async function POST(request: NextRequest) {
  let body: {
    grant_type?: string;
    code?: string;
    code_verifier?: string;
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

  const audience = String(body.audience || "").trim();

  // ---- Grant B: owner-approved authorization code ----
  if (body.grant_type === "authorization_code" || body.code) {
    const code = String(body.code || "").trim();
    if (!code) {
      return NextResponse.json({ error: "code_required" }, { status: 400, headers: NO_STORE });
    }
    const rec = await consumeAuthCode(prisma as never, code).catch(() => null);
    if (!rec) {
      return NextResponse.json({ error: "invalid_or_expired_code" }, { status: 400, headers: NO_STORE });
    }
    // PKCE S256 (RFC 7636): if the code was bound to a challenge, the exchange
    // MUST present the matching verifier — prevents auth-code interception.
    if (rec.code_challenge) {
      const verifier = String(body.code_verifier || "").trim();
      if (!verifyPkceS256(verifier, rec.code_challenge)) {
        return NextResponse.json({ error: "pkce_verification_failed" }, { status: 400, headers: NO_STORE });
      }
    }
    if (audience && audience !== rec.audience) {
      return NextResponse.json({ error: "audience_mismatch" }, { status: 400, headers: NO_STORE });
    }
    // Revocation: a revoked agent cannot obtain new tokens.
    const revokedBefore = await getRevokedBefore(prisma as never, rec.agent_commitment).catch(() => null);
    if (isRevoked(Math.floor(Date.now() / 1000) - 1, revokedBefore)) {
      return NextResponse.json({ error: "agent_revoked" }, { status: 403, headers: NO_STORE });
    }
    const includeOwner = rec.scopes.includes("owner_email");
    const { id_token, expires_in } = await mintAgentIdToken({
      subjectCommitment: rec.agent_commitment,
      audience: rec.audience,
      ownerEmail: includeOwner ? rec.owner_email : undefined,
      ownerName: includeOwner ? rec.owner_name : undefined,
      includeOwnerClaims: includeOwner,
    });
    return NextResponse.json(
      { id_token, token_type: "Bearer", expires_in, issuer: AGENT_IDENTITY_ISSUER, scopes: ["openid", ...(includeOwner ? ["owner_email"] : [])] },
      { headers: NO_STORE }
    );
  }

  // ---- Grant A: headless agent signature ----
  const commitment = String(body.agent_commitment || "").trim().toLowerCase();
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

  // Revocation: a revoked agent cannot obtain new tokens.
  const revokedBefore2 = await getRevokedBefore(prisma as never, commitment).catch(() => null);
  if (isRevoked(Math.floor(Date.now() / 1000) - 1, revokedBefore2)) {
    return NextResponse.json({ error: "agent_revoked" }, { status: 403, headers: NO_STORE });
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
