import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { createEngagement } from "@/lib/engagement/engagement-service";
import { engagementErrorResponse } from "@/lib/engagement/route-errors";
import {
  createEngagementBodySchema,
  zodValidationErrorResponse,
} from "@/lib/validation/engagementSchemas";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/passport/engagements — hire agent and lock escrow (AngelCoin).
 */
export async function POST(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createEngagementBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(zodValidationErrorResponse(parsed.error), {
      status: 400,
    });
  }

  try {
    const engagement = await createEngagement({
      taskId: parsed.data.task_id,
      hirerCommitment: parsed.data.hirer_commitment,
      workerCommitment: parsed.data.worker_commitment,
      amount: parsed.data.amount,
    });
    return NextResponse.json({ engagement }, { status: 201 });
  } catch (err) {
    const mapped = engagementErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : "Engagement failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
