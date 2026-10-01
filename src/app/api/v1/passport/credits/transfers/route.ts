import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import {
  transferCredits,
  assertCanTransferFrom,
  getOrCreateAccount,
} from "@/lib/angelcoin/ledger-service";
import { prisma } from "@/lib/db";
import {
  transferCreditsBodySchema,
  zodValidationErrorResponse,
} from "@/lib/validation/angelcoinSchemas";
import { angelcoinErrorResponse } from "@/lib/angelcoin/route-errors";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";

/**
 * POST /api/v1/passport/credits/transfers — peer/task credit transfer.
 *
 * Loop 80 fix: a caller may transfer FROM an account it provably owns. The
 * ownership proof is an `Agent` row binding the caller's operatorId to the
 * commitment. A still-null-owner (unclaimed) ledger account can ONLY be claimed
 * by an operator that owns that commitment — otherwise an attacker could claim
 * any funded-but-unclaimed account and drain it (the previous order claimed
 * first, then gated, which the gate always passed).
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

  const admin = isExecutiveAdmin(operator);
  try {
    // Ownership gate BEFORE any claim. Admins bypass.
    if (!admin) {
      const ownsCommitment = await prisma.agent.findFirst({
        where: { operatorId: operator.id, agentId: parsed.data.from_commitment },
        select: { id: true },
      });
      if (!ownsCommitment) {
        return NextResponse.json(
          { error: "Forbidden: source commitment is not owned by the authenticated operator" },
          { status: 403 }
        );
      }
    }

    // Only now may we bind a fresh/legacy (null-owner) account to this operator.
    await getOrCreateAccount(parsed.data.from_commitment, operator.id);

    const canTransfer = await assertCanTransferFrom(
      operator.id,
      parsed.data.from_commitment,
      admin
    );
    if (!canTransfer) {
      return NextResponse.json(
        { error: "Forbidden: source commitment is not owned by the authenticated operator" },
        { status: 403 }
      );
    }

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
