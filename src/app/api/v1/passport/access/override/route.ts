import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { setAdminOverride } from "@/lib/angelcoin/access-tiers";
import {
  accessOverrideBodySchema,
  zodValidationErrorResponse,
} from "@/lib/validation/angelcoinSchemas";
import { angelcoinErrorResponse } from "@/lib/angelcoin/route-errors";

/**
 * POST /api/v1/passport/access/override — set or clear admin override tier.
 */
export async function POST(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = accessOverrideBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(zodValidationErrorResponse(parsed.error), {
      status: 400,
    });
  }

  try {
    const result = await setAdminOverride(
      parsed.data.subject_commitment,
      parsed.data.tier
    );
    return NextResponse.json({
      subject_commitment: result.account.subjectCommitment,
      evaluation: result.evaluation,
      balances: result.balances,
      admin_override_tier: result.account.adminOverrideTier,
      access_tier: result.account.accessTier,
    });
  } catch (err) {
    const mapped = angelcoinErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : "Override failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
