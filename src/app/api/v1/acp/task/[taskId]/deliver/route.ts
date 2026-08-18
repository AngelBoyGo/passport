import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * ACP — Deliver task outcome with signed evidence
 * POST /api/v1/acp/task/:taskId/deliver
 * Body: { deliverable_digest: string, evidence_event_hash: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  let body: { deliverable_digest?: string; evidence_event_hash?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.deliverable_digest || !body.evidence_event_hash) {
    return NextResponse.json(
      { error: "deliverable_digest and evidence_event_hash required" },
      { status: 400 }
    );
  }

  const engagement = await prisma.engagement.findUnique({ where: { taskId } });
  if (!engagement) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (engagement.status !== "HELD") {
    return NextResponse.json({ error: `Task cannot be delivered in status: ${engagement.status}` }, { status: 409 });
  }

  const updated = await prisma.engagement.update({
    where: { taskId },
    data: {
      status: "DELIVERED",
      deliverableDigest: body.deliverable_digest,
      evidenceEventHash: body.evidence_event_hash,
    },
  });

  return NextResponse.json({
    acp_version: "1.0",
    task_id: updated.taskId,
    status: "delivered",
    deliverable_digest: updated.deliverableDigest,
    evidence_event_hash: updated.evidenceEventHash,
  });
}
