import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";
import { cancelEngagement } from "@/lib/engagement/engagement-service";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { EngagementStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/passport/engagements/{taskId}/timeout-release
 *
 * Metis Priority #1: Allows external systems (Metis marketplace) to release
 * escrow for stale HELD engagements. When a worker agent fails to deliver
 * within their eta_hours, Metis's timeout worker calls this endpoint to
 * unlock the hirer's credits and cancel the engagement.
 *
 * Auth: Requires an ISSUER API key (operator-level) or the SCHEDULER_SECRET.
 * The engagement must be in HELD status. PAID or DELIVERED engagements
 * cannot be timeout-released.
 *
 * This fixes Q10 + Q28 from the Metis integration audit.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`timeout-release:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  // Auth: API key or scheduler secret
  const authHeader = request.headers.get("authorization");
  const schedulerSecret = process.env.SCHEDULER_SECRET;
  const providedSecret = request.headers.get("x-scheduler-secret");

  let operatorId: string | null = null;
  let isScheduler = false;

  if (schedulerSecret && providedSecret === schedulerSecret) {
    isScheduler = true;
  } else {
    const operator = await authenticateApiKey(authHeader);
    if (!operator || operator.apiKeyRole !== "ISSUER") {
      return NextResponse.json(
        { error: "Unauthorized: ISSUER key or SCHEDULER_SECRET required" },
        { status: 401 }
      );
    }
    operatorId = operator.id;
  }

  const { taskId } = await params;
  if (!taskId || taskId.trim().length === 0) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  // Check the engagement exists and is in HELD status
  const engagement = await prisma.engagement.findUnique({
    where: { taskId: taskId.trim() },
    select: {
      taskId: true,
      status: true,
      hirerCommitment: true,
      workerCommitment: true,
      amount: true,
      createdAt: true,
    },
  });

  if (!engagement) {
    return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
  }

  if (engagement.status === EngagementStatus.PAID) {
    return NextResponse.json(
      { error: "Cannot timeout-release a PAID engagement" },
      { status: 409 }
    );
  }

  if (engagement.status === EngagementStatus.DELIVERED) {
    return NextResponse.json(
      { error: "Cannot timeout-release a DELIVERED engagement. Use accept or cancel instead." },
      { status: 409 }
    );
  }

  if (engagement.status === EngagementStatus.CANCELLED) {
    return NextResponse.json({
      status: "already_cancelled",
      taskId: engagement.taskId,
      message: "Engagement was already cancelled and escrow released.",
    });
  }

  // If authenticated via API key, verify the caller is the hirer or an admin
  if (!isScheduler && operatorId) {
    const hirerAgent = await prisma.agent.findFirst({
      where: { operatorId, agentId: engagement.hirerCommitment },
    });
    if (!hirerAgent) {
      return NextResponse.json(
        { error: "Forbidden: only the hirer or scheduler can timeout-release" },
        { status: 403 }
      );
    }
  }

  // Execute the cancellation (which handles unlockCredits internally)
  try {
    const result = await cancelEngagement(taskId.trim());
    return NextResponse.json({
      status: "released",
      taskId: result.taskId,
      engagement_status: result.status,
      amount_released: result.amount,
      hirer_commitment: result.hirerCommitment,
      worker_commitment: result.workerCommitment,
      released_by: isScheduler ? "scheduler" : "hirer",
      released_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Timeout release failed";
    const status = message.includes("not found") ? 404 : message.includes("already") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}