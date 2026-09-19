import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { prisma } from "@/lib/db";
import {
  transitionProposal,
  replayAndScore,
  type TransitionAction,
} from "@/lib/brain/proposal-service";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/** Actions that require explicit human authority — always audit-logged. */
const HUMAN_ACTIONS: Set<TransitionAction> = new Set(["approve", "canary", "promote", "reject", "rollback"]);

function statusForError(code: string | undefined): number {
  switch (code) {
    case "not_found": return 404;
    case "illegal_transition": return 409;
    case "canary_conflict": return 409;
    default: return 500;
  }
}

/**
 * POST /api/v1/raillab/brain/proposals/[proposalId] — advance a proposal through
 * the promotion state machine (ISSUER-auth).
 *
 * Body: { action: "replay" | "mark_audited" | "require_approval" | "approve" |
 *                "canary" | "promote" | "reject" | "rollback", window_days? }
 *
 * Human-authority actions (approve/canary/promote/reject/rollback) are written to
 * the AdminAuditLog with the operating key's identity.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ proposalId: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:brain:proposal:${ip}`, 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 20));
  }

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator || operator.apiKeyRole === "HOLDER") {
    return NextResponse.json({ error: "Unauthorized: ISSUER key required" }, { status: 401, headers: NO_STORE });
  }

  const { proposalId } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE });
  }

  const action = String(body.action ?? "") as TransitionAction;

  try {
    if (action === "replay") {
      const windowDays = Number(body.window_days);
      const result = await replayAndScore(
        proposalId,
        Number.isFinite(windowDays) && windowDays >= 1 && windowDays <= 90 ? windowDays : undefined
      );
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

    if (!action) {
      return NextResponse.json({ error: "action is required" }, { status: 400, headers: NO_STORE });
    }

    const result = await transitionProposal(proposalId, action, operator.id);

    if (HUMAN_ACTIONS.has(action)) {
      await prisma.adminAuditLog
        .create({
          data: {
            operatorId: operator.id,
            action: `brain_proposal_${action}`,
            targetId: proposalId,
            details: `${result.from} -> ${result.to}`,
          },
        })
        .catch(() => null);
    }

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