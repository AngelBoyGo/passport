import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/turnstile-config — returns the Turnstile site key for client-side rendering.
 */
export async function GET() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  return NextResponse.json({ siteKey });
}
