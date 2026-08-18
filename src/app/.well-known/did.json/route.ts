import { NextRequest, NextResponse } from "next/server";
import { getPublicKeyHex } from "@/lib/receipt/signer";

export const dynamic = "force-dynamic";

/**
 * ANP — Agent Network Protocol DID document.
 * GET /.well-known/did.json — W3C DID document for Passport.
 *
 * Each enrolled agent's subject_commitment can be expressed as a did:key
 * derived from their Ed25519 public key. This document describes the
 * Passport operator itself as a DID controller.
 */
export async function GET(_request: NextRequest) {
  let publicKey: string | null = null;
  try {
    publicKey = getPublicKeyHex();
  } catch {
    // SIGNING_PRIVATE_KEY may not be set
  }

  const did = `did:key:z${publicKey?.slice(0, 16) ?? "unknown"}`;

  const doc = {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1",
    ],
    id: did,
    verificationMethod: publicKey
      ? [
          {
            id: `${did}#${publicKey.slice(0, 16)}`,
            type: "Multikey",
            controller: did,
            publicKeyMultibase: `z${publicKey}`,
          },
        ]
      : [],
    authentication: publicKey ? [`${did}#${publicKey.slice(0, 16)}`] : [],
    assertionMethod: publicKey ? [`${did}#${publicKey.slice(0, 16)}`] : [],
    service: [
      {
        id: `${did}#passport-api`,
        type: "PassportAPI",
        serviceEndpoint: "https://passport.metis.gold/api/v1",
      },
      {
        id: `${did}#agent-card`,
        type: "AgentCard",
        serviceEndpoint: "https://passport.metis.gold/.well-known/agent.json",
      },
    ],
    alsoKnownAs: ["https://passport.metis.gold"],
  };

  return NextResponse.json(doc, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}