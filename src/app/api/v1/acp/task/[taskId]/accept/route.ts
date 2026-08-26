import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";
import { acceptEngagement } from "@/lib/engagement/engagement-service";
import { engagementErrorResponse } from "@/lib/engagement/route-errors";

export const dynamic = "force-dynamic";

/**
 * ACP — Accept deliverable and release escrow payout
 * POST /api/v1/acp/task/:taskId/accept
 * Body: { settle_on_chain?: boolean }
 *
 * H1/H37 fix: this mirrors the main engagement-accept path — PARTICIPANT-BOUND
 * (only the hirer/worker, proven by owning an Agent row for that commitment, or
 * an executive admin) and EVIDENCE-GATED (acceptEngagement requires the task to
 * be DELIVERED with anchored evidence before releasing escrow). Previously any
 * key holder could flip any DELIVERED task to PAID.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;

  const engagement = await prisma.engagement.findUnique({
    where: { taskId },
    select: { id: true, hirerCommitment: true, workerCommitment: true, status: true },
  });
  if (!engagement) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  if (engagement.status !== "DELIVERED") {
    return NextResponse.json(
      { error: `Task must be in DELIVERED state before accept (currently ${engagement.status})` },
      { status: 409 }
    );
  }

  const admin = isExecutiveAdmin(operator);
  const owned = await prisma.agent.findFirst({
    where: {
      operatorId: operator.id,
      agentId: { in: [engagement.hirerCommitment, engagement.workerCommitment] },
    },
    select: { id: true },
  });
  if (!owned && !admin) {
    return NextResponse.json(
      { error: "Forbidden: only the task hirer or worker may accept this task" },
      { status: 403 }
    );
  }

  let settleOnChain = false;
  const raw = await request.json().catch(() => ({}));
  if (raw && typeof raw.settle_on_chain === "boolean") settleOnChain = raw.settle_on_chain;

  try {
    const result = await acceptEngagement(taskId, { settleOnChain });
    return NextResponse.json({
      acp_version: "1.0",
      task_id: taskId,
      status: "paid",
      receipt_id: result.receipt_id,
      paid_at: result.engagement.paidAt,
    });
  } catch (err) {
    const mapped = engagementErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : "Accept failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}