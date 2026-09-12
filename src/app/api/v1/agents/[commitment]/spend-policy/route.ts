import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authorizeResource } from "@/lib/auth/authorize";
import {
  getSpendPolicy,
  setSpendPolicy,
  getRollingSpend,
  type SpendPolicyInput,
} from "@/lib/agent-economy/spend-policy-service";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * GET /api/v1/agents/[commitment]/spend-policy — read an agent's autonomous spend policy and
 * current rolling spend. Owner (HOLDER owning the agent) or ISSUER.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ commitment: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`agents:spend-policy:get:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { commitment } = await params;
  const auth = await authorizeResource(request, { kind: "agent", id: commitment });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }

  const [policy, spend] = await Promise.all([
    getSpendPolicy(commitment),
    getRollingSpend(commitment),
  ]);

  return NextResponse.json(
    { success: true, policy, spend },
    { headers: NO_STORE }
  );
}

/**
 * PUT /api/v1/agents/[commitment]/spend-policy — set/replace the policy. Body:
 * { enabled?, per_tx_max_angel?, daily_max_angel?, weekly_max_angel?,
 *   counterparty_allowlist?, domain_allowlist? }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ commitment: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`agents:spend-policy:put:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  const { commitment } = await params;
  const auth = await authorizeResource(request, { kind: "agent", id: commitment });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE });
  }

  const input: SpendPolicyInput = {
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    perTxMaxAngel: body.per_tx_max_angel != null ? Number(body.per_tx_max_angel) : undefined,
    dailyMaxAngel: body.daily_max_angel != null ? Number(body.daily_max_angel) : undefined,
    weeklyMaxAngel: body.weekly_max_angel != null ? Number(body.weekly_max_angel) : undefined,
    counterpartyAllowlist: Array.isArray(body.counterparty_allowlist)
      ? (body.counterparty_allowlist as string[])
      : undefined,
    domainAllowlist: Array.isArray(body.domain_allowlist)
      ? (body.domain_allowlist as string[])
      : undefined,
  };

  const policy = await setSpendPolicy(commitment, input, auth.operatorId);
  return NextResponse.json({ success: true, policy }, { headers: NO_STORE });
}
