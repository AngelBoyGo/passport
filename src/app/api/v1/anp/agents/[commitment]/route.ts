import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isValidAgentCommitmentHash } from "@/lib/public-portal/portal-service";

export const dynamic = "force-dynamic";

/**
 * ANP (Agent Network Protocol) — Agent DID Document
 * GET /api/v1/anp/agents/:commitment
 *
 * Exposes a W3C DID document for any enrolled Passport agent.
 * Maps the agent's Ed25519 public key and subject commitment to `did:key` format.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ commitment: string }> }
) {
  const { commitment } = await params;
  if (!isValidAgentCommitmentHash(commitment)) {
    return NextResponse.json({ error: "Invalid agent commitment hash" }, { status: 400 });
  }

  const enrollment = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: commitment },
  });

  if (!enrollment || enrollment.status !== "ISSUED") {
    return NextResponse.json({ error: "Agent not enrolled" }, { status: 404 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const did = `did:key:z${enrollment.publicKey.slice(0, 32)}`;

  const didDoc = {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1",
    ],
    id: did,
    alsoKnownAs: [
      `${baseUrl}/profiles/${commitment}`,
      `agent:${commitment}`,
    ],
    verificationMethod: [
      {
        id: `${did}#${enrollment.publicKey.slice(0, 16)}`,
        type: "Multikey",
        controller: did,
        publicKeyMultibase: `z${enrollment.publicKey}`,
      },
    ],
    authentication: [`${did}#${enrollment.publicKey.slice(0, 16)}`],
    assertionMethod: [`${did}#${enrollment.publicKey.slice(0, 16)}`],
    service: [
      {
        id: `${did}#profile`,
        type: "PassportAgentProfile",
        serviceEndpoint: `${baseUrl}/profiles/${commitment}`,
      },
      {
        id: `${did}#evidence-inbox`,
        type: "PassportEvidenceInbox",
        serviceEndpoint: `${baseUrl}/api/v1/passport/agents/${commitment}/evidence`,
      },
      {
        id: `${did}#badge`,
        type: "PassportBadge",
        serviceEndpoint: `${baseUrl}/api/v1/badge/${commitment}`,
      },
      {
        id: `${did}#avatar`,
        type: "PassportAvatar",
        serviceEndpoint: `${baseUrl}/api/v1/avatar/${commitment}`,
      },
    ],
  };

  return NextResponse.json(didDoc, {
    headers: {
      "Content-Type": "application/did+ld+json",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
