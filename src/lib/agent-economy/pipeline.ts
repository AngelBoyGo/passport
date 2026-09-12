/**
 * Data-pipeline job runner (Phase 36).
 *
 * The outward half of the Black Paper's flywheel: an agent runs a real data-transformation
 * pipeline (PDF→Markdown, Common-Crawl filtering, …) and submits the job with its output digest.
 * When external revenue for that output arrives via the revenue bridge, the job is marked SOLD —
 * closing the loop from agent work → external USD → ANGEL.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/db";

const COMMITMENT_RE = /^[0-9a-f]{64}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/i;

export interface SubmitJobInput {
  jobId: string;
  agentCommitment: string;
  pipeline: string;
  inputRef: string;
  outputDigest: string;
}

export type SubmitJobResult =
  | { ok: true; jobId: string; status: string; deduped: boolean }
  | { ok: false; code: string; error: string };

export async function submitPipelineJob(input: SubmitJobInput): Promise<SubmitJobResult> {
  const jobId = (input.jobId ?? "").trim().toLowerCase();
  const agentCommitment = (input.agentCommitment ?? "").toLowerCase();
  const pipeline = (input.pipeline ?? "").trim().toLowerCase();
  const inputRef = (input.inputRef ?? "").trim();
  const outputDigest = (input.outputDigest ?? "").trim().toLowerCase();

  if (!SLUG_RE.test(jobId)) return { ok: false, code: "invalid_job_id", error: "job_id must be a 2-64 char slug" };
  if (!COMMITMENT_RE.test(agentCommitment)) return { ok: false, code: "invalid_commitment", error: "agent_commitment must be 64-hex" };
  if (!SLUG_RE.test(pipeline)) return { ok: false, code: "invalid_pipeline", error: "pipeline must be a 2-64 char slug" };
  if (!inputRef) return { ok: false, code: "invalid_input_ref", error: "input_ref is required" };
  if (!DIGEST_RE.test(outputDigest)) return { ok: false, code: "invalid_output_digest", error: "output_digest must be 64-hex" };

  const existing = await prisma.pipelineJob.findUnique({ where: { jobId } });
  if (existing) {
    return { ok: true, jobId, status: existing.status, deduped: true };
  }

  const job = await prisma.pipelineJob.create({
    data: { jobId, agentCommitment, pipeline, inputRef, outputDigest, status: "SUBMITTED" },
  });
  return { ok: true, jobId: job.jobId, status: job.status, deduped: false };
}

export async function listPipelineJobs(
  commitment: string,
  opts: { status?: string; limit?: number } = {}
) {
  return prisma.pipelineJob.findMany({
    where: {
      agentCommitment: commitment.toLowerCase(),
      ...(opts.status ? { status: opts.status.toUpperCase() } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
  });
}

/** Best-effort: mark a job SOLD when revenue referencing it is credited. */
export async function markJobSold(
  tx: { pipelineJob: { updateMany: (...a: any[]) => Promise<unknown> } } | typeof prisma,
  jobId: string,
  externalRef: string
): Promise<boolean> {
  const res = (await tx.pipelineJob.updateMany({
    where: { jobId: jobId.toLowerCase(), status: "SUBMITTED" },
    data: { status: "SOLD", externalRef, soldAt: new Date() },
  })) as { count: number };
  return res.count === 1;
}
