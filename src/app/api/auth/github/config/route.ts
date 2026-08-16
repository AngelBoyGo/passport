import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/github/config — returns the GitHub OAuth client ID
 * for the client-side login page. Server-side routes can read env
 * vars at runtime, avoiding the NEXT_PUBLIC_* build-time bake issue.
 */
export async function GET() {
  const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID ?? process.env.GITHUB_CLIENT_ID ?? "";
  return NextResponse.json({ clientId });
}