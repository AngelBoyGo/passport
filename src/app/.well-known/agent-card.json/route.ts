import { NextRequest, NextResponse } from "next/server";
import { buildAgentCard } from "@/lib/discovery/agent-card";

export const dynamic = "force-dynamic";

/**
 * GET /.well-known/agent-card.json — alternate agent-card endpoint (some registries and
 * agent-discovery tools probe this path in addition to /agent.json). Serves the same
 * canonical card so a discovery scanner can never mistake Passport for undocumented.
 */
export async function GET(request: NextRequest) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const card = await buildAgentCard(baseUrl);

  return NextResponse.json(card, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}