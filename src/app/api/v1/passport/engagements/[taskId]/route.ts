import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { getEngagement } from "@/lib/engagement/engagement-service";
import { engagementErrorResponse } from "@/lib/engagement/route-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/passport/engagements/:taskId — read engagement status.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;
  try {
    const engagement = await getEngagement(taskId);
    return NextResponse.json({ engagement });
  } catch (err) {
    const mapped = engagementErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : "Engagement lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
