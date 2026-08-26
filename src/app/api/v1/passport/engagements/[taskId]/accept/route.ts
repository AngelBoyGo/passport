import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { acceptEngagement } from "@/lib/engagement/engagement-service";
import { engagementErrorResponse } from "@/lib/engagement/route-errors";
import { prisma } from "@/lib/db";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/passport/engagements/:taskId/accept — evidence-gated payout + receipt anchor.
 *
 * Loop 37 CRITICAL fix: escrow payout is now PARTICIPANT-BOUND. Only the task
 * hirer or worker (proven by owning an Agent row for that commitment), or an
 * executive admin, may release escrowed funds. Previously ANY valid API key
 * could trigger payout of anyone's locked AngelCoin balance.
 */
async function loadTaskAndAuthorize(
  request: NextRequest,
  taskId: string
): Promise<{ ok: true; operator: { id: string } } | { ok: false; status: number; error: string }> {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const engagement = await prisma.engagement.findUnique({
    where: { taskId },
    select: { id: true, hirerCommitment: true, workerCommitment: true },
  });
  if (!engagement) {
    return { ok: false, status: 404, error: "Task not found" };
  }

  if (isExecutiveAdmin(operator)) {
    return { ok: true, operator };
  }

  const owned = await prisma.agent.findFirst({
    where: {
      operatorId: operator.id,
      agentId: { in: [engagement.hirerCommitment, engagement.workerCommitment] },
    },
    select: { id: true },
  });
  if (!owned) {
    return {
      ok: false,
      status: 403,
      error: "Forbidden: only the task hirer or worker may act on this escrow",
    };
  }

  return { ok: true, operator };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  const auth = await loadTaskAndAuthorize(request, taskId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    let settleOnChain = false;
    const raw = await request.json().catch(() => ({}));
    if (raw && typeof raw.settleOnChain === "boolean") settleOnChain = raw.settleOnChain;

    const result = await acceptEngagement(taskId, { settleOnChain });
    return NextResponse.json(result);
  } catch (err) {
    const mapped = engagementErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : "Accept failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}