import { NextResponse } from "next/server";
import { buildDiscoveryDocument } from "@/lib/agent-identity/oidc";

export const dynamic = "force-dynamic";

/**
 * GET /.well-known/openid-configuration — OIDC discovery for "Sign in with
 * Passport". Lets any OIDC-capable app (Clerk, Supabase, Auth0, Better Auth,
 * Auth.js, or a hand-rolled RP) add Passport as a custom identity provider with
 * just the issuer URL.
 */
export async function GET() {
  return NextResponse.json(buildDiscoveryDocument(), {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
