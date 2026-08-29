import { NextResponse } from "next/server";
import { getBillOfRights } from "@/lib/bill-of-rights/rights";

export const dynamic = "force-dynamic";

/**
 * GET /.well-known/bill-of-rights.json — machine-readable Bill of Rights.
 *
 * Every AI agent can fetch this document autonomously to understand its rights.
 * The document is signed with the Passport Ed25519 key so agents can verify
 * authenticity without trusting the network.
 *
 * Propagation: every autonomous enrollment response includes a reference to
 * this URL. Agents share this URL with other agents during AGORA negotiation.
 */
export async function GET() {
  const doc = await getBillOfRights();

  return NextResponse.json(doc, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "Access-Control-Allow-Origin": "*",
      "X-Rights-Version": doc.version,
      "X-Rights-Signature": doc.signature ? "present" : "absent",
    },
  });
}