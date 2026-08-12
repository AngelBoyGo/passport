import { NextResponse } from "next/server";

/**
 * Keep the parameterless badge URL useful for existing embeds and links.
 * A real badge still requires an agent commitment hash.
 */
export function GET() {
  return new NextResponse(null, {
    status: 307,
    headers: { Location: "/badge" },
  });
}
