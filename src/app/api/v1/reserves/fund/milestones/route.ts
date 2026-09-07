import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { verifyMilestoneCompletion } from "@/lib/reserves/industrialization-fund";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/reserves/fund/milestones — Verify & release stabilization milestone disbursement.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:fund:milestones:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const disbursementId = String(body.disbursement_id || body.disbursementId || "");
  const verifierSignature = String(body.verifier_signature || body.verifierSignature || "");
  const verifierPublicKey = String(body.verifier_public_key || body.verifierPublicKey || "");
  const mediaDigest = String(body.media_digest || body.mediaDigest || "");
  const verificationDescription = body.verification_description ? String(body.verification_description) : undefined;
  const jobsCreated = body.jobs_created !== undefined ? Number(body.jobs_created) : undefined;
  const realizedImpactKwh = body.realized_impact_kwh !== undefined ? Number(body.realized_impact_kwh) : undefined;

  if (!disbursementId || !verifierSignature || !verifierPublicKey || !mediaDigest) {
    return NextResponse.json(
      { error: "disbursement_id, verifier_signature, verifier_public_key, media_digest are required" },
      { status: 400 }
    );
  }

  try {
    const result = await verifyMilestoneCompletion({
      disbursementId,
      verifierSignature,
      verifierPublicKey,
      mediaDigest,
      verificationDescription,
      jobsCreated,
      realizedImpactKwh,
    });

    return NextResponse.json(
      {
        success: true,
        disbursement: {
          disbursement_id: result.disbursement.disbursementId,
          milestone_number: result.disbursement.milestoneNumber,
          status: result.disbursement.status,
          amount_angel: result.disbursement.amountAngel,
          disbursed_at: result.disbursement.disbursedAt
            ? result.disbursement.disbursedAt.toISOString()
            : null,
        },
        project: {
          project_code: result.project.projectCode,
          status: result.project.status,
          completed_milestones: result.project.completedMilestones,
          total_milestones: result.project.totalMilestones,
        },
        is_complete: result.isComplete,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
