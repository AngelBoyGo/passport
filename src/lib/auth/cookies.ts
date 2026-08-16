import type { NextRequest } from "next/server";
import { resolveSessionFromTokens } from "@/lib/auth/auth-service";

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
 * session_token cookie candidate. Returns null when unauthenticated.
 */
export async function sessionFromRequest(request: NextRequest) {
  return resolveSessionFromTokens(sessionTokensFromRequest(request));
}