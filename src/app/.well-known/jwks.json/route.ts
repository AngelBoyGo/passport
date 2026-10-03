import { NextResponse } from "next/server";
import { buildJwks } from "@/lib/agent-identity/oidc";

export const dynamic = "force-dynamic";

/**
 * GET /.well-known/jwks.json — JWKS for the Passport agent-identity issuer.
 * Property 3 of an agent ID: a relying app verifies an agent's id_token against
 * this document WITHOUT having to trust the agent. EdDSA (Ed25519).
 */
export async function GET() {
  return NextResponse.json(buildJwks(), {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
