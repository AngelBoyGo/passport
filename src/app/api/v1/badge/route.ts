import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Keep the parameterless badge URL useful for existing embeds and links.
 * A real badge still requires an agent commitment hash.
 */
export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/badge", request.url), 307);
}
