import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/google/config — returns the Google OAuth client ID
 * for the client-side login page. Must be a server route because
 * NEXT_PUBLIC_* vars are inlined at build time in Docker; runtime
 * env vars work normally in server routes.
 */
export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  return NextResponse.json({ clientId });
}