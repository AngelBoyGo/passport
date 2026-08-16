import { NextResponse } from "next/server";
import { getPublicKeyHex } from "@/lib/receipt/signer";

export const PUBLIC_KEY_CACHE_CONTROL = "public, max-age=3600";

/**
 * GET /api/v1/public-key — published ed25519 verifying key.
 */
export async function GET() {
  return NextResponse.json(
    {
      algorithm: "ed25519",
      public_key: getPublicKeyHex(),
      note: "Open verify routine in src/lib/receipt/verify.ts — tamper-evident, not unforgeable.",
    },
    {
      headers: {
        "Cache-Control": PUBLIC_KEY_CACHE_CONTROL,
      },
    }
  );
}
