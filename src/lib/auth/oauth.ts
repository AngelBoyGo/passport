import { NextRequest, NextResponse } from "next/server";

/**
 * Shared OAuth helpers.
 *
 * Hardens callbacks against:
 *  - Login CSRF: every callback requires a `state` nonce that matches the
 *    httpOnly cookie set by the config endpoint. Without a matching nonce, the
 *    callback is rejected — an attacker can no longer inject an auth-code
 *    exchange into the victim's browser session.
 *  - Host-header redirect injection: the base URL is always the configured
 *    NEXT_PUBLIC_APP_URL (allow-listed), never derived from Host/Origin.
 */
export function getBaseUrl(request: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
}

export function oauthStateCookieName(provider: "github" | "google"): string {
  return `oauth_state_${provider}`;
}

/** Returns { ok: true } when the provided state matches the cookie. */
export function verifyOAuthState(
  request: NextRequest,
  provider: "github" | "google",
  state: string | null
): { ok: true } | { ok: false; redirectTo: string } {
  const expected = request.cookies.get(oauthStateCookieName(provider))?.value;
  if (!state || !expected || state !== expected) {
    return {
      ok: false,
      redirectTo: `/login?error=oauth_state_mismatch`,
    };
  }
  return { ok: true };
}

export function clearOAuthStateCookie(
  response: NextResponse,
  provider: "github" | "google"
): void {
  response.cookies.set(oauthStateCookieName(provider), "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}