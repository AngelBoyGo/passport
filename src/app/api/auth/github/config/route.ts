import { NextResponse } from "next/server";
import { bytesToHex } from "@noble/hashes/utils.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/github/config — returns the GitHub OAuth client ID plus a
 * CSRF-protection `state` nonce (set as an httpOnly cookie, mirrored in the
 * response so the client can append it to the authorize URL).
 */
export async function GET() {
  const clientId = process.env.GITHUB_CLIENT_ID ?? "";
  const state = bytesToHex(crypto.getRandomValues(new Uint8Array(24)));

  const response = NextResponse.json({ clientId, state });
  response.cookies.set("oauth_state_github", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}