import { NextResponse } from "next/server";
import { getPublicKeyHex } from "@/lib/receipt/signer";

export const PUBLIC_KEY_CACHE_CONTROL = "public, max-age=3600";

/**
 * GET /api/v1/public-key — published ed25519 verifying key with rotation metadata.
 */
export async function GET() {
  const publicKey = getPublicKeyHex();
  return NextResponse.json(
    {
      algorithm: "ed25519",
      public_key: publicKey,
      kid: `ed25519:${publicKey.slice(0, 16)}`,
      valid_from: "2026-01-01T00:00:00.000Z",
      rotation_policy: "Keys are rotated manually. Check /api/v1/public-key/key-history for past keys.",
      note: "Open verify routine in src/lib/receipt/verify.ts — tamper-evident, not unforgeable.",
    },
    {
      headers: {
        "Cache-Control": PUBLIC_KEY_CACHE_CONTROL,
      },
    }
  );
}