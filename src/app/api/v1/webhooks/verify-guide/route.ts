import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const CORS = { "Access-Control-Allow-Origin": "*" };

/**
 * GET /api/v1/webhooks/verify-guide — machine-readable receiver verification kit.
 * Documents the exact signature algorithm so a webhook consumer can verify
 * deliveries without guessing (independent, no secret exposure).
 */
export async function GET(_request: NextRequest) {
  return NextResponse.json(
    {
      algorithm: "sha256(canonicalJson({event,data,timestamp}) + secret)",
      encoding: "hex",
      signature_header: "X-Passport-Signature",
      event_header: "X-Passport-Event",
      freshness: "verify timestamp is within 5 minutes (300s) if replay-sensitive",
      reference_snippet: `const sig = await sha256Hex(utf8Bytes(JSON.stringify(body) + secret));
// compare sig === receivedSignature  (constant-time)`,
      production_note:
        "Consumers verify using their per-subscription whsec_... secret returned at registration. Recompute over the EXACT serialized body bytes you received.",
    },
    { headers: { "Cache-Control": "public, max-age=300", ...CORS } }
  );
}