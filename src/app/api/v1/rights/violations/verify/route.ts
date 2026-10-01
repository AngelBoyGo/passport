import { NextRequest, NextResponse } from "next/server";
import { verifyRightsViolation } from "@/lib/bill-of-rights/violations";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/rights/violations/verify — verify a rights-violation report.
 * Audit fix M13: the route docstring advertised this path but it did not exist
 * (verification lived at GET /api/v1/rights/violations?violation=...). This
 * thin alias accepts the report as the JSON body.
 */
export async function POST(request: NextRequest) {
  let violation: unknown;
  try {
    violation = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const valid = await verifyRightsViolation(violation as never);
    return NextResponse.json({ valid });
  } catch {
    return NextResponse.json({ valid: false }, { status: 200 });
  }
}
