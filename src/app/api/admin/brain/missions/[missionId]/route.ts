import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";
import { setMissionStatus, MISSION_STATUSES, type MissionStatus } from "@/lib/brain/mission-service";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/admin/brain/missions/[missionId] — operator override of a mission's
 * status (pause / resume / achieve / abandon). Executive-admin only, audit-logged.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ missionId: string }> }
) {
  const session = await sessionFromRequest(request);
  if (!session || !isExecutiveAdmin(session.operator)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const { missionId } = await params;
  const body = (await request.json().catch(() => ({}))) as { status?: string };
  const next = String(body.status ?? "").toUpperCase() as MissionStatus;
  if (!MISSION_STATUSES.includes(next)) {
    return NextResponse.json(
      { error: `invalid_status:${body.status}`, allowed: MISSION_STATUSES },
      { status: 400, headers: NO_STORE }
    );
  }
  const result = await setMissionStatus(missionId, next);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400, headers: NO_STORE });
  }
  await prisma.adminAuditLog
    .create({
      data: {
        operatorId: session.operator.id,
        action: "brain_mission_status",
        targetId: missionId,
        details: `set status=${next}`,
      },
    })
    .catch(() => undefined);
  return NextResponse.json({ ok: true, missionId, status: next }, { headers: NO_STORE });
}
