import { NextRequest, NextResponse } from "next/server";
import { verifyGatePass } from "@/lib/gate/verifyGatePass";
import { parsePublicOperatorId, resolveOperatorByPublicId } from "@/lib/operator";
import { withRouteObservability } from "@/lib/observability/route-wrapper";
import {
  checkInMemoryRateLimit,
  clientIpFromRequest,
  rateLimitResponse,
  GATE_VERIFY_MAX_REQUESTS,
} from "@/lib/rateLimit";
import { OperationalDomain } from "@prisma/client";

export const dynamic = "force-dynamic";

async function postGateVerify(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`gate-verify:${ip}`);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      rateLimitResponse(rate, GATE_VERIFY_MAX_REQUESTS)
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { operator_id, domain } = body;
  if (
    typeof operator_id !== "string" ||
    typeof domain !== "string" ||
    !(domain in OperationalDomain)
  ) {
    return NextResponse.json(
      { error: "Required: operator_id (string), domain (OperationalDomain)" },
      { status: 400 }
    );
  }

  if (!parsePublicOperatorId(operator_id)) {
    return NextResponse.json(
      {
        error:
          "operator_id must be a public id (op_cus_...) — not a database id",
      },
      { status: 400 }
    );
  }

  const operator = await resolveOperatorByPublicId(operator_id);
  if (!operator) {
    return NextResponse.json({ error: "Operator not found" }, { status: 404 });
  }

  const result = await verifyGatePass(
    operator.id,
    domain as OperationalDomain
  );
  return NextResponse.json(result);
}

export const POST = withRouteObservability(postGateVerify, "gate_verify");
