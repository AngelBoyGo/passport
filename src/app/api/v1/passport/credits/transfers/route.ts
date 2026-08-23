import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import {
  transferCredits,
  assertCanTransferFrom,
  getOrCreateAccount,
} from "@/lib/angelcoin/ledger-service";
import {
  transferCreditsBodySchema,
  zodValidationErrorResponse,
} from "@/lib/validation/angelcoinSchemas";
import { angelcoinErrorResponse } from "@/lib/angelcoin/route-errors";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";

/**
 * POST /api/v1/passport/credits/transfers — peer/task credit transfer.
 * H5 fix: a caller may only transfer FROM an account it owns (ownerOperatorId
 * set when the operator first created/claimed it) or as an executive admin.
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

  const canTransfer = await assertCanTransferFrom(
    operator.id,
    parsed.data.from_commitment,
    isExecutiveAdmin(operator)
  );
  if (!canTransfer) {
    return NextResponse.json(
      { error: "Forbidden: source commitment is not owned by the authenticated operator" },
      { status: 403 }
    );
  }

  try {
    // Claim ownership on the sender's account if it does not yet exist (the
    // operator is effectively the creator/steward of the source commitment).
    await getOrCreateAccount(parsed.data.from_commitment, operator.id);
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
