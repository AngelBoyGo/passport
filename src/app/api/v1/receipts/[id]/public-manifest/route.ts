import { NextRequest, NextResponse } from "next/server";
import {
  checkInMemoryRateLimit,
  clientIpFromRequest,
} from "@/lib/rateLimit";
import { getReceiptPublicManifest } from "@/lib/public-portal/portal-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/receipts/:id/public-manifest — masked receipt manifest.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`receipt-manifest:${ip}`);
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

  const { id } = await params;
  const manifest = await getReceiptPublicManifest(id);
  if (!manifest) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  return NextResponse.json(manifest);
}
