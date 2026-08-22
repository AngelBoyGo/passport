import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { getAgentWallet } from "@/lib/agent-pay/agent-payment-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/agent-pay/wallet — read the authenticated agent/operator wallet
 * (credit balance) that funds Passport attestation products.
 */
export async function GET(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const wallet = await getAgentWallet(operator.id);
  return NextResponse.json({ ...wallet, role: operator.apiKeyRole ?? "ISSUER" });
}