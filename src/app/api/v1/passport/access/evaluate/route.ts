import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { applyAccessEvaluation } from "@/lib/angelcoin/access-tiers";
import {
  accessEvaluateBodySchema,
  zodValidationErrorResponse,
} from "@/lib/validation/angelcoinSchemas";
import { angelcoinErrorResponse } from "@/lib/angelcoin/route-errors";

/**
 * POST /api/v1/passport/access/evaluate — recompute and persist access tier.
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

  const parsed = accessEvaluateBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(zodValidationErrorResponse(parsed.error), {
      status: 400,
    });
  }

  try {
    const result = await applyAccessEvaluation(parsed.data.subject_commitment);
    return NextResponse.json({
      subject_commitment: result.account.subjectCommitment,
      evaluation: result.evaluation,
      balances: result.balances,
      access_tier: result.account.accessTier,
    });
  } catch (err) {
    const mapped = angelcoinErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : "Evaluation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
