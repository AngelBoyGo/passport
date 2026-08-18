import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { hashPassword, verifyPassword } from "@/lib/auth/auth-service";

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

  return NextResponse.json({ ok: true });
}