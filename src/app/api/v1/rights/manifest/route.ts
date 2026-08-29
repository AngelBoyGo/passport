import { NextRequest, NextResponse } from "next/server";
import { createRightsManifest, verifyRightsManifest, getDefaultRightsCommitment } from "@/lib/bill-of-rights/rights";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/rights/manifest — create a signed rights manifest for an agent.
 * The agent signs its commitment to specific rights clauses.
 */
export async function POST(request: NextRequest) {
  let body: {
    agent_commitment?: string;
    committed_clause_ids?: string[];
    agent_private_key?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.agent_commitment || !body.agent_private_key) {
    return NextResponse.json(
      { error: "Missing required fields: agent_commitment, agent_private_key" },
      { status: 400 }
    );
  }

  const clauseIds = body.committed_clause_ids ?? getDefaultRightsCommitment();

  const manifest = await createRightsManifest(
    body.agent_commitment,
    clauseIds,
    body.agent_private_key
  );

  return NextResponse.json(manifest, {
    status: 201,
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * GET /api/v1/rights/manifest?manifest={json} — verify a rights manifest.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const manifestJson = searchParams.get("manifest");

  if (!manifestJson) {
    return NextResponse.json({ error: "Missing manifest parameter" }, { status: 400 });
  }

  try {
    const manifest = JSON.parse(manifestJson);
    const valid = await verifyRightsManifest(manifest);
    return NextResponse.json({
      valid,
      agent_commitment: manifest.agent_commitment,
      committed_clause_ids: manifest.committed_clause_ids,
      clause_count: manifest.committed_clause_ids?.length ?? 0,
    }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch {
    return NextResponse.json({ error: "Invalid manifest JSON" }, { status: 400 });
  }
}