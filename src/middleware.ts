import { NextRequest, NextResponse } from "next/server";
import { resolveCorsHeaders } from "@/lib/security/cors";

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60_000;

function getRateLimitInfo(ip: string): { count: number; limit: number; resetAt: number } {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    const resetAt = now + RATE_LIMIT_WINDOW_MS;
    rateBuckets.set(ip, { count: 1, resetAt });
    return { count: 1, limit: RATE_LIMIT_MAX, resetAt };
  }
  bucket.count++;
  return { count: bucket.count, limit: RATE_LIMIT_MAX, resetAt: bucket.resetAt };
}

/**
 * Production CORS corridor middleware for /api routes.
 */
export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const origin = request.headers.get("origin");
  const isProduction = process.env.NODE_ENV === "production";

  const cors = resolveCorsHeaders({
    pathname,
    origin,
    method: request.method,
    isProduction,
  });

  if (cors.block) {
    return NextResponse.json(
      { error: "Origin not allowed for administrative route" },
      { status: 403 }
    );
  }

  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: cors.headers });
  }

  const response = NextResponse.next();
  for (const [key, value] of Object.entries(cors.headers)) {
    response.headers.set(key, value);
  }

  // Rate-limit headers for API routes
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
  const rl = getRateLimitInfo(ip);
  response.headers.set("X-RateLimit-Limit", String(rl.limit));
  response.headers.set("X-RateLimit-Remaining", String(Math.max(0, rl.limit - rl.count)));
  response.headers.set("X-RateLimit-Reset", String(Math.ceil(rl.resetAt / 1000)));

  return response;
}

export const config = {
  matcher: "/api/:path*",
};