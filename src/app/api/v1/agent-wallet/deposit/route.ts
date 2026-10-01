import { NextRequest } from "next/server";
import { POST as walletPOST } from "../route";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/agent-wallet/deposit — alias for the main wallet route with
 * action="deposit" (audit fix M13: the JSDoc advertised these sub-routes).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const req = new NextRequest(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify({ ...body, action: "deposit" }),
  });
  return walletPOST(req);
}
