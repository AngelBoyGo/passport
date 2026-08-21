import { NextResponse } from "next/server";
import { createReceiptCheckpoint } from "@/lib/receipt/merkle-checkpoint";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/receipts/checkpoints/latest — retrieve signed Merkle root over finalized receipts.
 * Public external anchor allowing third parties to prove Passport has not rewritten history.
 */
export async function GET() {
  const checkpoint = await createReceiptCheckpoint();
  return NextResponse.json(checkpoint, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
