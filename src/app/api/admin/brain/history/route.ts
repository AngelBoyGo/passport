import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export interface CycleHistoryItem {
  cycleId: string;
  at: string;
  action: string | null;
  outcome: string | null;
  healthScore: number | null;
  observationSummary: string | null;
  decisionRationale: string | null;
}

/**
 * GET /api/admin/brain/history — get the last 20 brain cycles with paired observations, decisions, and outcomes.
 * Auth: session cookie + isExecutiveAdmin.
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
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 20, 1), 50);

  const rows = await prisma.brainMemory.findMany({
    orderBy: { createdAt: "desc" },
    take: limit * 4,
  });

  // Group by cycleId
  const cycleMap = new Map<string, {
    cycleId: string;
    at: string;
    action: string | null;
    outcome: string | null;
    healthScore: number | null;
    observationSummary: string | null;
    decisionRationale: string | null;
  }>();

  for (const r of rows) {
    if (!r.cycleId) continue;
    let item = cycleMap.get(r.cycleId);
    if (!item) {
      item = {
        cycleId: r.cycleId,
        at: r.createdAt.toISOString(),
        action: null,
        outcome: null,
        healthScore: null,
        observationSummary: null,
        decisionRationale: null,
      };
      cycleMap.set(r.cycleId, item);
    }

    if (r.kind === "OBSERVATION") {
      item.observationSummary = r.summary;
      if (r.healthScore != null) item.healthScore = r.healthScore;
    } else if (r.kind === "DECISION") {
      item.action = r.action;
      item.decisionRationale = r.summary;
    } else if (r.kind === "OUTCOME") {
      item.action = item.action || r.action;
      item.outcome = r.actionResult;
    }
  }

  const history = Array.from(cycleMap.values())
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);

  return NextResponse.json({ success: true, history }, { headers: NO_STORE });
}
