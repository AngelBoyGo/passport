import { NextRequest, NextResponse } from "next/server";
import { createReceiptCheckpoint } from "@/lib/receipt/merkle-checkpoint";
import { authenticateApiKey } from "@/lib/operator";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/receipts/checkpoints — trigger a new signed Merkle checkpoint snapshot.
 */
export async function POST(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checkpoint = await createReceiptCheckpoint();
  return NextResponse.json(checkpoint, {
    status: 201,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * GET /api/v1/receipts/checkpoints — get current anchor checkpoint.
 */
export async function GET() {
  const checkpoint = await createReceiptCheckpoint();
  return NextResponse.json({ checkpoints: [checkpoint] }, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
