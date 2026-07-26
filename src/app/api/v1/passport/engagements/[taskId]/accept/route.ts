import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { acceptEngagement } from "@/lib/engagement/engagement-service";
import { engagementErrorResponse } from "@/lib/engagement/route-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/passport/engagements/:taskId/accept — evidence-gated payout + receipt anchor.
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
  try {
    const result = await acceptEngagement(taskId);
    return NextResponse.json(result);
  } catch (err) {
    const mapped = engagementErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : "Accept failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
