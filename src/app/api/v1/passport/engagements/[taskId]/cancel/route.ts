import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { cancelEngagement } from "@/lib/engagement/engagement-service";
import { engagementErrorResponse } from "@/lib/engagement/route-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/passport/engagements/:taskId/cancel — unlock escrow and cancel hire.
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
    const engagement = await cancelEngagement(taskId);
    return NextResponse.json({ engagement });
  } catch (err) {
    const mapped = engagementErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : "Cancel failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
