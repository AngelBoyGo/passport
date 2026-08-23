import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { grantCredits } from "@/lib/angelcoin/ledger-service";
import {
  grantCreditsBodySchema,
  zodValidationErrorResponse,
} from "@/lib/validation/angelcoinSchemas";
import { angelcoinErrorResponse } from "@/lib/angelcoin/route-errors";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";

/**
 * POST /api/v1/passport/credits/grants — operator grant of AngelCoin credits.
 * H5 fix: minting credits is a privileged supply operation. Only executive
 * admin operators may grant credits, so any key-holder can no longer inflate
 * supply for arbitrary subjects.
 */
export async function POST(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isExecutiveAdmin(operator)) {
    return NextResponse.json(
      { error: "Forbidden: only executive admins may grant credits" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = grantCreditsBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(zodValidationErrorResponse(parsed.error), {
      status: 400,
    });
  }

  try {
    const result = await grantCredits(
      parsed.data.subject_commitment,
      parsed.data.amount,
      parsed.data.metadata
    );
    return NextResponse.json(
      {
        subject_commitment: result.account.subjectCommitment,
        entry: result.entry,
        balances: result.balances,
      },
      { status: 201 }
    );
  } catch (err) {
    const mapped = angelcoinErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : "Grant failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
