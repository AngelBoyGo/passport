import { NextResponse } from "next/server";
import { getKeyTransparencyLog } from "@/lib/transparency/key-log";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/transparency/keys — public append-only key transparency log.
 * Shows every signing key Passport has used with validity windows and commitments.
 */
export async function GET() {
  const log = getKeyTransparencyLog();
  return NextResponse.json(log, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
