import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      { authenticated: false },
      { status: 401, headers: NO_STORE }
    );
  }

  return NextResponse.json(
    {
      authenticated: true,
      executiveAdmin: isExecutiveAdmin(session.operator),
      operator: {
        id: session.operator.id,
        email: session.operator.email,
        credits: session.operator.credits,
        tier: session.operator.tier,
      },
    },
    { headers: NO_STORE }
  );
}
