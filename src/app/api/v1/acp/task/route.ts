import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";

export const dynamic = "force-dynamic";

/**
 * ACP — Agent Communication Protocol adapter.
 * POST /api/v1/acp/task — create an ACP task (maps to Passport engagement)
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

  if (!body.task_id || !body.hirer_commitment || !body.worker_commitment || !body.amount) {
    return NextResponse.json({ error: "task_id, hirer_commitment, worker_commitment, amount are required" }, { status: 400 });
  }

  const engagement = await prisma.engagement.create({
    data: {
      taskId: body.task_id,
      hirerCommitment: body.hirer_commitment,
      workerCommitment: body.worker_commitment,
      amount: body.amount,
      status: "HELD",
    },
  });

  return NextResponse.json({
    acp_version: "1.0",
    task_id: engagement.taskId,
    status: "held",
    engagement_url: `${request.headers.get("origin") || "https://passport.metis.gold"}/api/v1/passport/engagements/${engagement.taskId}`,
  }, { status: 201 });
}