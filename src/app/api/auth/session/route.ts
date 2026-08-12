import { NextRequest, NextResponse } from "next/server";
import { getSessionFromToken } from "@/lib/auth/auth-service";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";

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
    executiveAdmin: isExecutiveAdmin(session.operator),
    operator: {
      id: session.operator.id,
      email: session.operator.email,
      credits: session.operator.credits,
      tier: session.operator.tier,
    },
  });
}
