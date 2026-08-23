import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionFromRequest } from "@/lib/auth/cookies";
import {
  hashPassword,
  verifyPassword,
  deleteAllSessionsForOperator,
  createSession,
} from "@/lib/auth/auth-service";
import { sessionCookieOptions } from "@/lib/auth/cookies";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.currentPassword || !body.newPassword) {
    return NextResponse.json({ error: "currentPassword and newPassword are required" }, { status: 400 });
  }
  if (body.newPassword.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });
  }
  if (body.currentPassword === body.newPassword) {
    return NextResponse.json({ error: "New password must differ from current password" }, { status: 400 });
  }

  const operator = await prisma.operator.findUnique({ where: { id: session.operator.id } });
  if (!operator || !operator.passwordHash) {
    return NextResponse.json({ error: "Cannot change password for this account" }, { status: 400 });
  }

  if (!await verifyPassword(body.currentPassword, operator.passwordHash)) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  const newHash = await hashPassword(body.newPassword);
  await prisma.operator.update({
    where: { id: operator.id },
    data: { passwordHash: newHash },
  });

  // Security: invalidate ALL existing sessions (including other devices) so a
  // leaked/stale session forces re-auth after a password change, matching the
  // password-reset behavior. Issue a fresh session for the current request.
  await deleteAllSessionsForOperator(operator.id);
  const newSession = await createSession(operator.id);

  const response = NextResponse.json({ ok: true });
  response.cookies.set("session_token", newSession.token, sessionCookieOptions(request));
  return response;
}