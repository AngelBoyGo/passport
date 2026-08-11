import { NextRequest, NextResponse } from "next/server";
import { login, createSession } from "@/lib/auth/auth-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.email || !body.password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  const result = await login(body.email, body.password);
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }

  const session = await createSession(result.operator!.id);

  const response = NextResponse.json({
    operator: { id: result.operator!.id, email: result.operator!.email },
  });

  response.cookies.set("session_token", session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });

  return response;
}