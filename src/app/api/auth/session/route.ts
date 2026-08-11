import { NextRequest, NextResponse } from "next/server";
import { getSessionFromToken } from "@/lib/auth/auth-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.cookies.get("session_token")?.value;
  if (!token) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const session = await getSessionFromToken(token);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    operator: {
      id: session.operator.id,
      email: session.operator.email,
      credits: session.operator.credits,
      tier: session.operator.tier,
    },
  });
}