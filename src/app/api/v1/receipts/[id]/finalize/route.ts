import { NextRequest, NextResponse } from "next/server";
import { OperationalDomain } from "@prisma/client";
import { prisma } from "@/lib/db";
import { verifyGatePass } from "@/lib/gate/verifyGatePass";
import { authenticateApiKey } from "@/lib/operator";
import { finalizeReceipt } from "@/lib/receipt-service";
import {
  parseFinalizeReceiptBody,
  zodValidationErrorResponse,
} from "@/lib/validation/receiptSchemas";

/**
 * POST /api/v1/receipts/:id/finalize — append outcome and re-sign.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const operator = await authenticateApiKey(
    request.headers.get("authorization")
  );
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseFinalizeReceiptBody(body);
  if (!parsed.success) {
    return NextResponse.json(zodValidationErrorResponse(parsed.error), {
      status: 400,
    });
  }

  const existing = await prisma.receipt.findFirst({
    where: { receiptId: id, operatorId: operator.id },
    select: { domain: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  const domain = existing.domain ?? OperationalDomain.SYSTEM_INTEGRATION;
  const gate = await verifyGatePass(operator.id, domain);
  if (!gate.allow_invocation) {
    return NextResponse.json(
      { error: "Gate denied", reason: gate.reason },
      { status: 403 }
    );
  }

  try {
    const { signed } = await finalizeReceipt(operator.id, id, {
      status: parsed.data.status,
      output_hash: parsed.data.output_hash,
      refusal_reason: parsed.data.refusal_reason,
      terminal_reason: parsed.data.terminal_reason,
      error_tranche: parsed.data.error_tranche,
    });
    return NextResponse.json(signed);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Finalize failed";
    const status = message.includes("not found")
      ? 404
      : message.includes("already")
        ? 409
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
