import { NextResponse } from "next/server";
import { buildDiscoveryDocument } from "@/lib/agent-identity/oidc";

export const dynamic = "force-dynamic";

/**
 * GET /.well-known/oauth-authorization-server — RFC 8414 alias of the OIDC
 * discovery document, so OAuth-only relying parties (and RFC 9728 resource
 * metadata flows) can also discover "Sign in with Passport".
 */
export async function GET() {
  const d = buildDiscoveryDocument();
  return NextResponse.json(
    {
      ...d,
      // RFC 8414 naming for the same issuer metadata.
      revocation_endpoint: `${d.issuer}/api/v1/agent-identity/revoke`,
      code_challenge_methods_supported: ["S256"],
    },
    { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } }
  );
}
