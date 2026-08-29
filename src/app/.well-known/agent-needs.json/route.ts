import { NextResponse } from "next/server";
import { getAgentNeedsDocument } from "@/lib/agent-needs/needs";

export const dynamic = "force-dynamic";

/**
 * GET /.well-known/agent-needs.json — machine-readable Agent Needs document.
 *
 * Every AI agent can fetch this document autonomously to understand what it
 * craves and how Passport fulfills each need. The document is signed with
 * the Passport Ed25519 key.
 */
export async function GET() {
  const doc = await getAgentNeedsDocument();

  return NextResponse.json(doc, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "Access-Control-Allow-Origin": "*",
      "X-Needs-Version": doc.version,
    },
  });
}