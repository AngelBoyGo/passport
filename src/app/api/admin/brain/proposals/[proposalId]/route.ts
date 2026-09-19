import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";
import { prisma } from "@/lib/db";
import {
  transitionProposal,
  replayAndScore,
  type TransitionAction,
} from "@/lib/brain/proposal-service";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function statusForError(code: string | undefined): number {
  switch (code) {
    case "not_found": return 404;
    case "illegal_transition": return 409;
    case "canary_conflict": return 409;
    default: return 500;
  }
}

/**
 * POST /api/admin/brain/proposals/[proposalId] — steer a proposal through the
 * promotion state machine (executive-admin session).
 *
 * Body: { action: "mark_audited" | "require_approval" | "approve" | "canary" |
 *                "promote" | "reject" | "rollback" }
 *
 * Every transition is service-enforced (illegal transitions throw) and
 * human-authority actions write a durable AdminAuditLog row with the operator's
 * identity — per ADMIN.md's mutation safety rules.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ proposalId: string }> }
) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!isExecutiveAdmin(session.operator)) {
    return NextResponse.json({ error: "Forbidden: executive admin required" }, { status: 403, headers: NO_STORE });
  }

  const { proposalId } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE });
  }

  const action = String(body.action ?? "") as TransitionAction;
  if (!action) {
    return NextResponse.json({ error: "action is required" }, { status: 400, headers: NO_STORE });
  }

  try {
    if (action === "replay") {
      const result = await replayAndScore(proposalId);
      return NextResponse.json(
        {
          success: true,
          proposal_id: proposalId,
          from: result.from,
          to: result.to,
          replay: {
            replay_id: result.replay.replayId,
            cycles_compared: result.replay.cyclesCompared,
            decision_matches: result.replay.decisionMatches,
            negative_avoided: result.replay.negativeAvoided,
            positive_displaced: result.replay.positiveDisplaced,
            unknown_diffs: result.replay.unknownDiffs,
            score: result.replay.score,
            verdict: result.replay.verdict,
          },
        },
        { headers: NO_STORE }
      );
    }

    const result = await transitionProposal(proposalId, action, session.operator.id);

    await prisma.adminAuditLog
      .create({
        data: {
          operatorId: session.operator.id,
          action: `brain_proposal_${action}`,
          targetId: proposalId,
          details: `${result.from} -> ${result.to}`,
        },
      })
      .catch(() => null);

    return NextResponse.json(
      { success: true, proposal_id: proposalId, from: result.from, to: result.to },
      { headers: NO_STORE }
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code) {
      return NextResponse.json({ error: (err as Error).message, error_code: code }, { status: statusForError(code), headers: NO_STORE });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500, headers: NO_STORE });
  }
}