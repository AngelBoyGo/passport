import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * GET /api/v1/admin/audit-log — the admin audit log.
 *
 * Audit fix M13: the AI Bill of Rights doc advertises this as the grievance
 * escalation surface, but no such route existed. Executive-admin gated.
 *
 * Query: ?action=rights.violation.reported&limit=100
 */
export async function GET(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!isExecutiveAdmin(session.operator)) {
    return NextResponse.json({ error: "Forbidden: executive admin required" }, { status: 403, headers: NO_STORE });
  }
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || undefined;
  const limit = Math.min(500, Math.max(1, Number.parseInt(searchParams.get("limit") || "100", 10) || 100));

  const rows = await prisma.adminAuditLog.findMany({
    where: action ? { action } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, operatorId: true, action: true, targetId: true, details: true, createdAt: true },
  });
  return NextResponse.json({ count: rows.length, rows }, { headers: NO_STORE });
}
