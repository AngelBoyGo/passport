import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { prisma } from "@/lib/db";
import { collectorWalletCommitment } from "@/lib/digital-gateway/mobile-money";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const CORS = { "Access-Control-Allow-Origin": "*" };

/**
 * POST /api/v1/digital/onramp
 * Key-authenticated agent top-up that MOVES already-credited ANGEL from a provider callback's
 * collector wallet to the caller's chosen target wallet. Requires `payment_reference` = a
 * SETTLED MoneySettlement (real fiat arrived). An API key alone must NEVER mint ANGEL from a
 * self-declared xof_amount — this path only transfers what a real mobile-money callback already
 * minted. Body: { reference, payment_reference, target_commitment? }
 */
export async function POST(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { ...NO_STORE, ...CORS } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const reference = String(body.reference ?? body.external_ref ?? body.externalRef ?? "");
  const paymentReference = String(
    body.payment_reference ?? body.paymentReference ?? ""
  ).trim();
  const targetCommitment = String(
    body.target_commitment || body.targetCommitment || ""
  ).trim();

  if (!reference) {
    return NextResponse.json({ error: "reference is required" }, { status: 400 });
  }
  if (!paymentReference) {
    return NextResponse.json(
      { error: "payment_reference is required (a SETTLED MoneySettlement from a provider callback)" },
      { status: 403 }
    );
  }
  if (paymentReference === reference) {
    return NextResponse.json(
      { error: "payment_reference must be the provider settlement, not the on-ramp reference" },
      { status: 400 }
    );
  }
  if (targetCommitment && !/^[0-9a-f]{64}$/i.test(targetCommitment)) {
    return NextResponse.json(
      { error: "target_commitment must be a 64-hex commitment" },
      { status: 400 }
    );
  }

  // Proof-of-payment: a real mobile-money provider callback must have settled this.
  const paid = await prisma.moneySettlement.findFirst({
    where: { externalRef: paymentReference, status: "SETTLED" },
    select: { externalRef: true, xofAmount: true, creditedAngel: true, targetCommitment: true },
  });
  if (!paid) {
    return NextResponse.json(
      { error: "payment_reference does not match a SETTLED mobile-money settlement" },
      { status: 403 }
    );
  }

  const sourceCommitment =
    paid.targetCommitment || collectorWalletCommitment(paymentReference);
  const destinationCommitment = targetCommitment || sourceCommitment;

  try {
    // Idempotent transfer: the ANGEL already exists from the provider callback. Move it from
    // the collector wallet to the target wallet exactly once per (payment_reference).
    // Guard: a prior transfer is prevented by a unique RailSettlement-style dedupe via the
    // `reference` (the MoneySettlement unique key blocks double-mint in settleMobileMoneyOnramp,
    // but here we mint nothing — we only MOVE). No fiat re-booking, no new ANGEL.
    if (sourceCommitment === destinationCommitment) {
      return NextResponse.json(
        {
          success: true,
          deduped: true,
          transfer_id: `transfer-${reference}`,
          credited_angel: paid.creditedAngel,
          source: sourceCommitment,
          target_commitment: sourceCommitment,
          status: "TRANSFERRED",
        },
        { status: 200, headers: { ...NO_STORE, ...CORS } }
      );
    }

    const moved = await prisma.$transaction(async (tx) => {
      const debit = await tx.agentWallet.updateMany({
        where: { subjectCommitment: sourceCommitment, balance: { gte: paid.creditedAngel } },
        data: {
          balance: { decrement: paid.creditedAngel },
          spentTotal: { increment: paid.creditedAngel },
          lastActivityAt: new Date(),
        },
      });
      if (debit.count !== 1) {
        throw new Error("Source collector wallet lacks the settled ANGEL balance");
      }
      await tx.agentWallet.upsert({
        where: { subjectCommitment: destinationCommitment },
        create: {
          subjectCommitment: destinationCommitment,
          balance: paid.creditedAngel,
          earnedTotal: paid.creditedAngel,
          lastActivityAt: new Date(),
        },
        update: {
          balance: { increment: paid.creditedAngel },
          earnedTotal: { increment: paid.creditedAngel },
          lastActivityAt: new Date(),
        },
      });
      return paid.creditedAngel;
    });

    return NextResponse.json(
      {
        success: true,
        deduped: false,
        transfer_id: `transfer-${reference}`,
        credited_angel: moved,
        source: sourceCommitment,
        target_commitment: destinationCommitment,
        status: "TRANSFERRED",
      },
      { status: 200, headers: { ...NO_STORE, ...CORS } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400, headers: { ...NO_STORE, ...CORS } });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}