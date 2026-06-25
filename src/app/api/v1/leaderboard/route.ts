import { NextRequest, NextResponse } from "next/server";
import {
  checkInMemoryRateLimit,
  clientIpFromRequest,
} from "@/lib/rateLimit";
import {
  getLeaderboard,
  parseLeaderboardLimit,
} from "@/lib/public-portal/portal-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/leaderboard — masked agent evidence leaderboard.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`leaderboard:${ip}`);
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

  const parsed = parseLeaderboardLimit(
    new URL(request.url).searchParams.get("limit")
  );
  if (!parsed.ok) {
    return NextResponse.json({ error: "Invalid limit parameter" }, { status: 400 });
  }

  const rows = await getLeaderboard({ limit: parsed.limit });
  return NextResponse.json({ leaderboard: rows });
}
