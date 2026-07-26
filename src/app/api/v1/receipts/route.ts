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
