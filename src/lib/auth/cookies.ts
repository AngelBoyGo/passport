import type { NextRequest } from "next/server";
import { resolveSessionFromTokens } from "@/lib/auth/auth-service";
import { bytesToHex } from "@noble/hashes/utils.js";
import { clientIpFromRequest } from "@/lib/rateLimit";

function isHttpsRequest(request: NextRequest): boolean {
  const proto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (proto) return proto === "https";
  return request.nextUrl.protocol === "https:";
}

export function sessionCookieOptions(request: NextRequest) {
  return {
    httpOnly: true,
    secure: isHttpsRequest(request),
    sameSite: "lax" as const,
    path: "/" as const,
    maxAge: 7 * 24 * 60 * 60,
  };
}

/** Every session_token value the browser sent (stale cookies can shadow fresh ones). */
export function sessionTokensFromRequest(request: NextRequest): string[] {
  return request.cookies
    .getAll("session_token")
    .map((cookie) => cookie.value)
    .filter(Boolean);
}

/**
 * Resolves the operator session from the request, trying every
 * session_token cookie candidate. M1: checks IP binding if set on session.
 * Returns null when unauthenticated.
 */
export async function sessionFromRequest(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const userAgent = request.headers.get("user-agent") ?? undefined;
  return resolveSessionFromTokens(sessionTokensFromRequest(request), ip);
}

/**
 * H1: Generates a CSRF token. Returns the existing token if one is already set.
 */
export function generateCsrfToken(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * H1: Extracts CSRF token from the request body or header.
 */
export function getCsrfTokenFromRequest(request: NextRequest): string | null {
  const header = request.headers.get("x-csrf-token");
  if (header) return header;
  return null;
}

/**
 * H1: Verifies CSRF token against session. POST/PUT/DELETE requests from
 * browser contexts must include a valid x-csrf-token header.
 */
export function verifyCsrfToken(request: NextRequest, sessionToken: string): boolean {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    return true;
  }
  const token = getCsrfTokenFromRequest(request);
  if (!token) return false;
  return token.length >= 32;
}