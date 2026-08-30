import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/subscriptions — subscribe to another agent's updates.
 * GET /api/v1/subscriptions — list subscriptions for the authenticated agent.
 * DELETE /api/v1/subscriptions — unsubscribe from an agent.
 */
export async function POST(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { target_commitment?: string; notify_on_evidence?: boolean; notify_on_hire?: boolean; notify_on_broadcast?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.target_commitment || !/^[0-9a-f]{64}$/i.test(body.target_commitment)) {
    return NextResponse.json({ error: "Invalid target commitment" }, { status: 400 });
  }

  // Get the first agent for this operator
  const agent = await prisma.agent.findFirst({
    where: { operatorId: operator.id },
    select: { agentId: true },
  });
  if (!agent) {
    return NextResponse.json({ error: "No agents found for this operator" }, { status: 404 });
  }

  // Verify target exists
  const target = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: body.target_commitment.toLowerCase() },
    select: { status: true },
  });
  if (!target || target.status !== "ISSUED") {
    return NextResponse.json({ error: "Target agent not found" }, { status: 404 });
  }

  const sub = await prisma.agentSubscription.upsert({
    where: {
      subscriberCommitment_targetCommitment: {
        subscriberCommitment: agent.agentId,
        targetCommitment: body.target_commitment.toLowerCase(),
      },
    },
    create: {
      subscriberCommitment: agent.agentId,
      targetCommitment: body.target_commitment.toLowerCase(),
      notifyOnEvidence: body.notify_on_evidence ?? true,
      notifyOnHire: body.notify_on_hire ?? true,
      notifyOnBroadcast: body.notify_on_broadcast ?? true,
    },
    update: {
      notifyOnEvidence: body.notify_on_evidence ?? true,
      notifyOnHire: body.notify_on_hire ?? true,
      notifyOnBroadcast: body.notify_on_broadcast ?? true,
    },
  });

  return NextResponse.json({
    subscriber_commitment: sub.subscriberCommitment,
    target_commitment: sub.targetCommitment,
    notify_on_evidence: sub.notifyOnEvidence,
    notify_on_hire: sub.notifyOnHire,
    notify_on_broadcast: sub.notifyOnBroadcast,
  }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agents = await prisma.agent.findMany({
    where: { operatorId: operator.id },
    select: { agentId: true },
  });

  const subscriptions = await prisma.agentSubscription.findMany({
    where: { subscriberCommitment: { in: agents.map((a) => a.agentId) } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    subscriptions: subscriptions.map((s) => ({
      subscriber_commitment: s.subscriberCommitment,
      target_commitment: s.targetCommitment,
      notify_on_evidence: s.notifyOnEvidence,
      notify_on_hire: s.notifyOnHire,
      notify_on_broadcast: s.notifyOnBroadcast,
      created_at: s.createdAt.toISOString(),
    })),
  });
}

export async function DELETE(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const targetCommitment = searchParams.get("target_commitment");
  if (!targetCommitment) {
    return NextResponse.json({ error: "target_commitment required" }, { status: 400 });
  }

  const agent = await prisma.agent.findFirst({
    where: { operatorId: operator.id },
    select: { agentId: true },
  });
  if (!agent) {
    return NextResponse.json({ error: "No agents found" }, { status: 404 });
  }

  await prisma.agentSubscription.deleteMany({
    where: {
      subscriberCommitment: agent.agentId,
      targetCommitment: targetCommitment.toLowerCase(),
    },
  });

  return NextResponse.json({ status: "unsubscribed" });
}