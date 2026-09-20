import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";
import { runBrainCycle, BRAIN_ACTIONS, type BrainAction } from "@/lib/brain/command-brain";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/admin/brain/cycle — trigger an immediate Command Brain cycle from the executive console.
 * Auth: session cookie + isExecutiveAdmin.
 * Optional body: { forceAction?: BrainAction }
 */
export async function POST(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!isExecutiveAdmin(session.operator)) {
    return NextResponse.json({ error: "Forbidden: executive admin required" }, { status: 403, headers: NO_STORE });
  }

  let body: { forceAction?: string } = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine — runs normal autonomous cycle
  }

  try {
    let report;
    if (body.forceAction && BRAIN_ACTIONS.includes(body.forceAction as BrainAction)) {
      const action = body.forceAction as BrainAction;
      // Run cycle with model instruction targeted to the forced action
      report = await runBrainCycle(new Date(), {
        complete: async () =>
          JSON.stringify({
            action,
            params: {},
            rationale: `Executive manual trigger: ${action} initiated by operator ${session.operator.email ?? session.operator.id}`,
            confidence: 1.0,
          }),
      });
    } else {
      report = await runBrainCycle();
    }

    // Record executive audit log
    await prisma.adminAuditLog.create({
      data: {
        operatorId: session.operator.id,
        action: "brain_cycle_manual_trigger",
        targetId: report.cycle_id,
        details: `Action: ${report.action} (${report.action_result}), Health: ${report.health_score}`,
      },
    }).catch(() => null);

    return NextResponse.json({ success: true, report }, { headers: NO_STORE });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}
