import { NextRequest, NextResponse } from "next/server";
import { deleteAllSessionsForOperator, safeQuery } from "@/lib/auth/auth-service";
import { sessionCookieOptions, sessionTokensFromRequest, sessionFromRequest } from "@/lib/auth/cookies";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // Resolve the session to find the operator ID, then delete ALL their sessions
  const session = await sessionFromRequest(request);

  // Delete every session token the browser sent
  for (const token of sessionTokensFromRequest(request)) {
    await safeQuery(() =>
      import("@/lib/db").then(({ prisma }) =>
        prisma.session.deleteMany({ where: { token } })
      )
    );
  }

  // If we resolved the session, also delete all other sessions for this operator
  if (session) {
    await deleteAllSessionsForOperator(session.operator.id);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("session_token", "", { ...sessionCookieOptions(request), maxAge: 0 });

  return response;
}