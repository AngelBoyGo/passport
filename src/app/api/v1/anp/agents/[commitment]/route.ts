import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isValidAgentCommitmentHash } from "@/lib/public-portal/portal-service";
import { encodeDidKeyZ, encodeMultibaseEd25519 } from "@/lib/crypto/multibase";

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

  // ANP fix: use proper did:key (multicodec ed25519) and W3C Multikey encodings,
  // not the previous hex-prefix concatenation which was not valid multibase.
  const didKeyValue = encodeDidKeyZ(enrollment.publicKey); // "z" + base58btc(0xed01||32-byte)
  const did = `did:key:${didKeyValue}`;
  const publicKeyMultibase = encodeMultibaseEd25519(enrollment.publicKey);

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
        id: `${did}#key-1`,
        type: "Multikey",
        controller: did,
        publicKeyMultibase,
      },
    ],
    authentication: [`${did}#key-1`],
    assertionMethod: [`${did}#key-1`],
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
