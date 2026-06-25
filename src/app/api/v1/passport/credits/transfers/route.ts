import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { transferCredits } from "@/lib/angelcoin/ledger-service";
import {
  transferCreditsBodySchema,
  zodValidationErrorResponse,
} from "@/lib/validation/angelcoinSchemas";
import { angelcoinErrorResponse } from "@/lib/angelcoin/route-errors";

/**
 * POST /api/v1/passport/credits/transfers — peer/task credit transfer.
 */
export async function POST(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = transferCreditsBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(zodValidationErrorResponse(parsed.error), {
      status: 400,
    });
  }

  try {
    const result = await transferCredits(
      parsed.data.from_commitment,
      parsed.data.to_commitment,
      parsed.data.amount,
      parsed.data.kind
    );
    return NextResponse.json({
      sender_entry: result.senderEntry,
      receiver_entry: result.receiverEntry,
      balances: result.balances,
    });
  } catch (err) {
    const mapped = angelcoinErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : "Transfer failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
