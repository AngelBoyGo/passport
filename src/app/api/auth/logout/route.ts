import { NextRequest, NextResponse } from "next/server";
import { deleteSession } from "@/lib/auth/auth-service";
import { sessionCookieOptions, sessionTokensFromRequest } from "@/lib/auth/cookies";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // Delete every session candidate the browser sent, not just the first.
  for (const token of sessionTokensFromRequest(request)) {
    await deleteSession(token);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("session_token", "", { ...sessionCookieOptions(request), maxAge: 0 });

  return response;
}