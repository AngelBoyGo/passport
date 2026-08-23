import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/admin/proxy — REMOVED.
 *
 * This route previously claimed to proxy APIKey-authenticated calls using the
 * session cookie, but in practice it only returned the operator identity — a
 * misleading stub. Admin surfaces now call their operator-scoped endpoints
 * directly (all /admin/* routes authenticate via the session cookie). This
 * endpoint is kept as an explicit 410 so any stale client contract fails loud
 * instead of silently doing the wrong thing.
 */
export async function POST(request: NextRequest) {
  return NextResponse.json(
    {
      error: "Admin proxy is removed. Use the /admin/* endpoints (or /api/v1 with a Bearer key) directly.",
      code: "ADMIN_PROXY_REMOVED",
    },
    { status: 410 }
  );
}