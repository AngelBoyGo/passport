import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { runDiscovery } from "@/lib/raillab/discovery";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/raillab/discover — trigger a live discovery scan.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:discover:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  try {
    const result = await runDiscovery();
    return NextResponse.json(
      {
        success: true,
        scanned_sources: result.scanned,
        created: result.created,
        skipped_duplicates: result.skippedDuplicates,
        source_errors: result.sourceErrors,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}