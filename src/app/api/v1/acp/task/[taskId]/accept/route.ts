import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";

export const dynamic = "force-dynamic";

/**
 * ACP — Accept deliverable and release escrow payout
 * POST /api/v1/acp/task/:taskId/accept
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
  const engagement = await prisma.engagement.findUnique({ where: { taskId } });
  if (!engagement) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (engagement.status !== "DELIVERED") {
    return NextResponse.json(
      { error: `Task must be in DELIVERED state before accept (currently ${engagement.status})` },
      { status: 409 }
    );
  }

  const updated = await prisma.engagement.update({
    where: { taskId },
    data: {
      status: "PAID",
      paidAt: new Date(),
    },
  });

  return NextResponse.json({
    acp_version: "1.0",
    task_id: updated.taskId,
    status: "paid",
    paid_at: updated.paidAt?.toISOString(),
  });
}
