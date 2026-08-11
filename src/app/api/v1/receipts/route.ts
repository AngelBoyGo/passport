import { NextRequest, NextResponse } from "next/server";
import {
  authenticateApiKey,
  operatorIdFromStripe,
} from "@/lib/operator";
import { verifyGatePass } from "@/lib/gate/verifyGatePass";
import { withRouteObservability } from "@/lib/observability/route-wrapper";
import { issueReceipt } from "@/lib/receipt-service";
import {
  parseIssueReceiptBody,
  zodValidationErrorResponse,
} from "@/lib/validation/receiptSchemas";
import type { Prisma } from "@prisma/client";
import { OperationalDomain } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * GET /api/v1/receipts — search receipts with filters.
 */
export async function GET(request: NextRequest) {
  const operator = await authenticateApiKey(
    request.headers.get("authorization")
  );
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get("domain");
  const status = searchParams.get("status");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 100);

  const where: Prisma.ReceiptWhereInput = { operatorId: operator.id };
  if (domain && Object.values(OperationalDomain).includes(domain as OperationalDomain)) {
    where.domain = domain as OperationalDomain;
  }
  if (status) where.status = status;
  if (from || to) {
    where.issuedAt = {};
    if (from) where.issuedAt.gte = new Date(from);
    if (to) where.issuedAt.lte = new Date(to);
  }

  const receipts = await prisma.receipt.findMany({
    where,
    orderBy: { issuedAt: "desc" },
    take: limit,
  });

  return NextResponse.json(receipts);
}

/**
 * POST /api/v1/receipts — issue a pending signed receipt (verifier write-only).
 */
async function postReceiptIssue(request: NextRequest) {
  const operator = await authenticateApiKey(
    request.headers.get("authorization")
  );
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseIssueReceiptBody(body);
  if (!parsed.success) {
    return NextResponse.json(zodValidationErrorResponse(parsed.error), {
      status: 400,
    });
  }

  const gate = await verifyGatePass(operator.id, parsed.data.domain);
  if (!gate.allow_invocation) {
    return NextResponse.json(
      { error: "Gate denied", reason: gate.reason },
      { status: 403 }
    );
  }

  try {
    const { signed } = await issueReceipt(operator.id, {
      operator_id: operatorIdFromStripe(operator.stripeCustomerId),
      agent_id: parsed.data.agent_id,
      receipt_type: parsed.data.receipt_type,
      input_digest: parsed.data.input_digest,
      authority_scope: parsed.data.authority_scope,
      expiry: parsed.data.expiry,
      prev_receipt_hash: parsed.data.prev_receipt_hash,
      domain: parsed.data.domain,
    });

    return NextResponse.json(signed, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Issue failed";
    const status = message.includes("credits") ? 402 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export const POST = withRouteObservability(postReceiptIssue, "receipt_issue");
