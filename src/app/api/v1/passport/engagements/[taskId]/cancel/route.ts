import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { cancelEngagement } from "@/lib/engagement/engagement-service";
import { engagementErrorResponse } from "@/lib/engagement/route-errors";
import { prisma } from "@/lib/db";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/passport/engagements/:taskId/cancel — unlock escrow and cancel hire.
 *
 * Loop 37 CRITICAL fix: only the task hirer or worker (proven via owned Agent
 * rows for those commitments), or an executive admin, may cancel and release
 * escrow. Previously ANY valid API key could cancel a victim's HELD engagement
 * and unlock their funds.
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
    select: { id: true, hirerCommitment: true, workerCommitment: true },
  });
  if (!engagement) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (!isExecutiveAdmin(operator)) {
    const owned = await prisma.agent.findFirst({
      where: {
        operatorId: operator.id,
        agentId: { in: [engagement.hirerCommitment, engagement.workerCommitment] },
      },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json(
        { error: "Forbidden: only the task hirer or worker may act on this escrow" },
        { status: 403 }
      );
    }
  }

  try {
    const result = await cancelEngagement(taskId);
    return NextResponse.json({ engagement: result });
  } catch (err) {
    const mapped = engagementErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : "Cancel failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}