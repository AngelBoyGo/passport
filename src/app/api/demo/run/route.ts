import { NextRequest, NextResponse } from "next/server";
import { runPublicDemo } from "@/lib/demo/runPublicDemo";
import {
  checkInMemoryRateLimit,
  clientIpFromRequest,
} from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const DEMO_MAX_REQUESTS = 10;
const DEMO_WINDOW_MS = 60 * 60 * 1000;

/**
 * POST /api/demo/run — public landing-page demo (issue + finalize server-side).
 * Returns 404 in production — demo endpoints are dev-only.
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(
    `demo-run:${ip}`,
    DEMO_MAX_REQUESTS,
    DEMO_WINDOW_MS
  );

  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: rate.retryAfterSec
          ? { "Retry-After": String(rate.retryAfterSec) }
          : undefined,
      }
    );
  }

  try {
    const result = await runPublicDemo();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Demo failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
