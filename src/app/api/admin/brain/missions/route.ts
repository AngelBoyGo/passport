import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";
import { listActiveMissions, getCurrentPlan } from "@/lib/brain/mission-service";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * GET /api/admin/brain/missions — active missions + their committed plans.
 * Executive-admin only (mission objectives/theses are sensitive strategy).
 */
export async function GET(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session || !isExecutiveAdmin(session.operator)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const active = await listActiveMissions(20);
  const missions = await Promise.all(
    active.map(async (m) => {
      const plan = await getCurrentPlan(m.missionId).catch(() => null);
      return {
        missionId: m.missionId,
        title: m.title,
        objective: m.objective,
        thesis: m.thesis,
        status: m.status,
        priority: m.priority,
        originPersona: m.originPersona,
        plan: plan
          ? { planId: plan.planId, status: plan.status, steps: plan.steps }
          : null,
      };
    })
  );

  const recentDialogue = await prisma.brainMemory.findMany({
    where: { kind: "DIALOGUE" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { cycleId: true, summary: true, actionResult: true, createdAt: true },
  });

  return NextResponse.json({ missions, recent_dialogue: recentDialogue }, { headers: NO_STORE });
}
