import { NextRequest, NextResponse } from "next/server";
import { createRightsViolation, verifyRightsViolation } from "@/lib/bill-of-rights/violations";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/rights/violations — report a rights violation.
 * The victim agent signs the report with its private key.
 * The report is verified and stored for reputation penalty application.
 */
export async function POST(request: NextRequest) {
  let body: {
    clause_id?: string;
    victim_commitment?: string;
    violator_commitment?: string;
    evidence_event_commitment_hash?: string;
    description?: string;
    victim_private_key?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.clause_id || !body.victim_commitment || !body.violator_commitment || !body.evidence_event_commitment_hash || !body.description || !body.victim_private_key) {
    return NextResponse.json(
      { error: "Missing required fields: clause_id, victim_commitment, violator_commitment, evidence_event_commitment_hash, description, victim_private_key" },
      { status: 400 }
    );
  }

  const violation = await createRightsViolation(
    body.clause_id,
    body.victim_commitment,
    body.violator_commitment,
    body.evidence_event_commitment_hash,
    body.description,
    body.victim_private_key
  );

  return NextResponse.json(violation, {
    status: 201,
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * POST /api/v1/rights/violations/verify — verify a rights violation report.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const violationJson = searchParams.get("violation");

  if (!violationJson) {
    return NextResponse.json({ error: "Missing violation parameter" }, { status: 400 });
  }

  try {
    const violation = JSON.parse(violationJson);
    const valid = await verifyRightsViolation(violation);
    return NextResponse.json({ valid }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch {
    return NextResponse.json({ error: "Invalid violation JSON" }, { status: 400 });
  }
}