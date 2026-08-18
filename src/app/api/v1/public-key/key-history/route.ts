import { NextResponse } from "next/server";
import { getPublicKeyHex } from "@/lib/receipt/signer";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/public-key/key-history — list all known public keys with validity windows.
 * Currently returns the current key only. When keys are rotated, this endpoint
 * will list all historical keys so verifiers can validate old receipts.
 */
export async function GET() {
  let publicKey: string | null = null;
  try {
    publicKey = getPublicKeyHex();
  } catch {
    return NextResponse.json({ keys: [] });
  }

  return NextResponse.json({
    keys: [
      {
        kid: `ed25519:${publicKey.slice(0, 16)}`,
        public_key: publicKey,
        algorithm: "ed25519",
        valid_from: "2026-01-01T00:00:00.000Z",
        valid_until: null,
        note: "Current active key. null valid_until means it is still in use.",
      },
    ],
  });
}