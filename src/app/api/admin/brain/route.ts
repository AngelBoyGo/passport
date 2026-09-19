import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";
import { buildCommandCenterData } from "@/lib/brain/command-center-data";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * GET /api/admin/brain — brain command-center snapshot for the executive console.
 *
 * Auth: session cookie + ADMIN_OPERATOR_EMAILS executive allowlist (fail-closed in
 * production — an empty allowlist denies). This is CEO-only data: brain decisions,
 * measured attributions, and the proposal pipeline.
 */
export async function GET(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!isExecutiveAdmin(session.operator)) {
    return NextResponse.json({ error: "Forbidden: executive admin required" }, { status: 403, headers: NO_STORE });
  }

  const data = await buildCommandCenterData();
  return NextResponse.json(
    { success: true, executiveAdmin: true, ...data },
    { headers: NO_STORE }
  );
}