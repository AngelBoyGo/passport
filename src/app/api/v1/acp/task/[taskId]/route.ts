import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * ACP — Agent Communication Protocol adapter.
 * GET /api/v1/acp/task/:taskId — get ACP task status
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const engagement = await prisma.engagement.findUnique({ where: { taskId } });
  if (!engagement) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({
    acp_version: "1.0",
    task_id: engagement.taskId,
    status: engagement.status.toLowerCase(),
    amount: engagement.amount,
    deliverable_digest: engagement.deliverableDigest,
    evidence_event_hash: engagement.evidenceEventHash,
    receipt_id: engagement.receiptId,
    paid_at: engagement.paidAt,
  });
}