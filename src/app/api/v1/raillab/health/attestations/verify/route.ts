import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import {
  verifyIntegrityAttestation,
  getIntegrityPublicKeyHex,
} from "@/lib/raillab/attest";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/raillab/health/attestations/verify — offline verify of an integrity attestation.
 * Body: the full signed attestation object. Returns { valid, reason }.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:attestations:verify:${ip}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 60));
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON: expected a full signed attestation object" },
      { status: 400 }
    );
  }

  try {
    const result = await verifyIntegrityAttestation(
      body as unknown as Parameters<typeof verifyIntegrityAttestation>[0]
    );
    return NextResponse.json(
      { valid: result.valid, reason: result.reason ?? "ok", public_key: getIntegrityPublicKeyHex() },
      { status: result.valid ? 200 : 400 }
    );
  } catch {
    return NextResponse.json(
      { valid: false, reason: "attestation payload is malformed" },
      { status: 400 }
    );
  }
}