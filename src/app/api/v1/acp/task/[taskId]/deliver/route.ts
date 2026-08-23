import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";

export const dynamic = "force-dynamic";

/**
 * ACP — Deliver task outcome with signed evidence
 * POST /api/v1/acp/task/:taskId/deliver
 * Body: { deliverable_digest: string, evidence_event_hash: string }
 *
 * H13 fix: delivery is now AUTHENTICATED, and only the engagement's worker (or
 * an executive admin) may mark a task delivered. Previously anyone could flip
 * an engagement to DELIVERED without verifying the evidence hash.
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

  // H13: only the worker (owner of the worker_commitment) may deliver. Because
  // commitments are pseudonymous, we bind via the operator's own Agent/subject
  // records: the operator must own an Agent row whose agentId equals the
  // workerCommitment, OR be an executive admin.
  const { isExecutiveAdmin } = await import("@/lib/admin/admin-auth");
  const ownedAgent = await prisma.agent.findFirst({
    where: { operatorId: operator.id, agentId: engagement.workerCommitment },
    select: { id: true },
  });
  if (!ownedAgent && !isExecutiveAdmin(operator)) {
    return NextResponse.json(
      { error: "Forbidden: only the task worker or an executive admin may deliver" },
      { status: 403 }
    );
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