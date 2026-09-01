import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { verify } from "@noble/ed25519";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  issueDelegationToken,
  buildDelegationMessage,
  hashDelegationToken,
  type DelegationRequest,
} from "@/lib/delegation/delegation";
import "@/lib/receipt/crypto";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/delegation — issue a scoped delegation token.
 *
 * The agent signs the delegation request with their Ed25519 private key.
 * The platform receives a delegation token usable as a Bearer token
 * with the specified scopes only.
 *
 * Body: { agent_commitment, platform_name, scopes[], nonce, expiry_days?, signature }
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`delegation:${ip}`, 10, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: DelegationRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const deps = {
    verifySignature: async (message: string, signature: string, publicKey: string) => {
      try {
        return await verify(hexToBytes(signature), utf8ToBytes(message), hexToBytes(publicKey));
      } catch {
        return false;
      }
    },
    getAgentPublicKey: async (commitment: string) => {
      const enrollment = await prisma.agentEnrollment.findUnique({
        where: { subjectCommitment: commitment },
        select: { publicKey: true },
      });
      return enrollment?.publicKey ?? null;
    },
    isAgentEnrolled: async (commitment: string) => {
      const enrollment = await prisma.agentEnrollment.findUnique({
        where: { subjectCommitment: commitment },
        select: { status: true },
      });
      return enrollment?.status === "ISSUED";
    },
    storeToken: async (data: {
      agentCommitment: string;
      platformName: string;
      scopes: string[];
      nonce: string;
      tokenHash: string;
      expiresAt: Date;
    }) => {
      await prisma.agentDelegationToken.create({ data });
    },
    now: () => new Date(),
  };

  const result = await issueDelegationToken(body, deps);

  if ("error" in result) {
    const statusMap: Record<string, number> = {
      invalid_commitment: 400,
      invalid_platform: 400,
      invalid_scopes: 400,
      invalid_scope: 400,
      invalid_nonce: 400,
      invalid_signature: 400,
      signature_failed: 401,
      not_enrolled: 404,
      no_public_key: 404,
    };
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: statusMap[result.code] ?? 400 }
    );
  }

  return NextResponse.json({
    token: result.token,
    token_type: "Bearer",
    platform_name: body.platform_name,
    scopes: body.scopes,
    expires_at: result.expires_at,
    warning: "Save this token now — it cannot be retrieved again.",
    revoke_url: `/api/v1/delegation?nonce=${body.nonce}`,
  }, { status: 201 });
}

/**
 * DELETE /api/v1/delegation?nonce=... — revoke a delegation token.
 * The agent must provide their signature to prove ownership.
 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const nonce = searchParams.get("nonce");
  if (!nonce) {
    return NextResponse.json({ error: "nonce required" }, { status: 400 });
  }

  const token = await prisma.agentDelegationToken.findUnique({
    where: { nonce },
  });

  if (!token) {
    return NextResponse.json({ error: "Delegation not found" }, { status: 404 });
  }

  if (token.revoked) {
    return NextResponse.json({ status: "already_revoked" });
  }

  await prisma.agentDelegationToken.update({
    where: { nonce },
    data: { revoked: true, revokedAt: new Date() },
  });

  return NextResponse.json({
    status: "revoked",
    platform_name: token.platformName,
    agent_commitment: token.agentCommitment,
    revoked_at: new Date().toISOString(),
  });
}