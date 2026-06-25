import { NextRequest, NextResponse } from "next/server";
import { resolveCorsHeaders } from "@/lib/security/cors";

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
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
