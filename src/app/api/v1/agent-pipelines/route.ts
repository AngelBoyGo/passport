import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authorizeResource } from "@/lib/auth/authorize";
import { submitPipelineJob } from "@/lib/agent-economy/pipeline";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

const STATUS_BY_CODE: Record<string, number> = {
  invalid_job_id: 400,
  invalid_commitment: 400,
  invalid_pipeline: 400,
  invalid_input_ref: 400,
  invalid_output_digest: 400,
};

/**
 * POST /api/v1/agent-pipelines — an agent submits a completed data-pipeline job. Owner/ISSUER.
 * Body: { job_id, agent_commitment, pipeline, input_ref, output_digest }
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`agent-pipelines:submit:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE });
  }

  const agentCommitment = String(body.agent_commitment ?? body.agentCommitment ?? "");
  const auth = await authorizeResource(request, { kind: "agent", id: agentCommitment });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }

  const result = await submitPipelineJob({
    jobId: String(body.job_id ?? body.jobId ?? ""),
    agentCommitment,
    pipeline: String(body.pipeline ?? ""),
    inputRef: String(body.input_ref ?? body.inputRef ?? ""),
    outputDigest: String(body.output_digest ?? body.outputDigest ?? ""),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, error_code: result.code },
      { status: STATUS_BY_CODE[result.code] ?? 400, headers: NO_STORE }
    );
  }
  return NextResponse.json(
    { success: true, job_id: result.jobId, status: result.status, deduped: result.deduped },
    { status: result.deduped ? 200 : 201, headers: NO_STORE }
  );
}
