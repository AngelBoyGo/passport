import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { createEngagement } from "@/lib/engagement/engagement-service";

export const dynamic = "force-dynamic";

/**
 * ACP — Agent Communication Protocol adapter.
 * POST /api/v1/acp/task — create an ACP task (maps to a Passport engagement)
 *
 * H2/H37: reuses createEngagement so escrow is ACTUALLY locked (lockCredits),
 * both parties must be enrolled, and commitments must differ — instead of the
 * previous raw prisma.engagement.create that bypassed the escrow ledger.
 */
export async function POST(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { task_id?: string; hirer_commitment?: string; worker_commitment?: string; amount?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.task_id || !body.hirer_commitment || !body.worker_commitment || typeof body.amount !== "number") {
    return NextResponse.json({ error: "task_id, hirer_commitment, worker_commitment, amount (integer) are required" }, { status: 400 });
  }
  if (!Number.isInteger(body.amount) || body.amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive integer" }, { status: 400 });
  }

  try {
    const engagement = await createEngagement({
      taskId: body.task_id,
      hirerCommitment: body.hirer_commitment,
      workerCommitment: body.worker_commitment,
      amount: body.amount,
    });

    return NextResponse.json({
      acp_version: "1.0",
      task_id: engagement.taskId,
      status: "held",
      engagement_url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://passport.metis.gold"}/api/v1/passport/engagements/${engagement.taskId}`,
    }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create task";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}