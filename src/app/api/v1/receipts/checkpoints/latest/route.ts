import { NextRequest, NextResponse } from "next/server";
import { createReceiptCheckpoint } from "@/lib/receipt/merkle-checkpoint";
import { deliverToExternalNotary } from "@/lib/notary/notary-anchor";
import { checkInMemoryRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/receipts/checkpoints/latest — retrieve signed Merkle root over finalized receipts.
 * Public external anchor allowing third parties to prove Passport has not rewritten history.
 *
 * Also attempts to publish the signed chain head to the configured independent
 * notary (NOTARY_ANCHOR_URL) so the ledger is externally pinned on each refresh.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`checkpoint-latest:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  const checkpoint = await createReceiptCheckpoint();

  // Fire-and-forget external anchoring (never blocks or fails the response).
  const anchor = await deliverToExternalNotary(checkpoint).catch(() => null);

  return NextResponse.json(
    {
      ...checkpoint,
      notary_anchor: anchor
        ? {
            anchor_id: anchor.anchor_id,
            endpoint_label: anchor.endpoint_label,
            endpoint_reachable: anchor.endpoint_reachable,
            delivery_hash: anchor.delivery_hash,
            submitted_at: anchor.submitted_at,
          }
        : null,
    },
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}