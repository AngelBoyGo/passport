import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { ensureOperatorWallet } from "@/lib/bridge/wallet";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * GET /api/v1/account/wallet — return the authenticated operator's custodial
 * wallet (creating it on first touch). Stablecoin deposits/withdrawals attach
 * to this wallet; agent earnings bind to it with KYC enforcement.
 */
export async function GET(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const wallet = await ensureOperatorWallet(session.operator.id);
  return NextResponse.json(
    {
      operator_id: wallet.operatorId,
      chain_address: wallet.chainAddress ?? null,
      upstream: wallet.upstream,
      subject_commitment: wallet.subjectCommitment ?? null,
      bridge_external_id: wallet.bridgeExternalId ?? null,
    },
    { headers: NO_STORE }
  );
}