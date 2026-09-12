import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authorizeResource } from "@/lib/auth/authorize";
import { listPipelineJobs } from "@/lib/agent-economy/pipeline";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/** GET /api/v1/agent-pipelines/[commitment] — an agent's pipeline jobs. Owner or ISSUER. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ commitment: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`agent-pipelines:get:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { commitment } = await params;
  const auth = await authorizeResource(request, { kind: "agent", id: commitment });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }

  const status = new URL(request.url).searchParams.get("status") ?? undefined;
  const jobs = await listPipelineJobs(commitment, { status });

  return NextResponse.json(
    {
      success: true,
      agent_commitment: commitment,
      count: jobs.length,
      jobs: jobs.map((j) => ({
        job_id: j.jobId,
        pipeline: j.pipeline,
        input_ref: j.inputRef,
        output_digest: j.outputDigest,
        status: j.status,
        external_ref: j.externalRef,
        at: j.createdAt.toISOString(),
        sold_at: j.soldAt?.toISOString() ?? null,
      })),
    },
    { headers: NO_STORE }
  );
}
