import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    pipelineJob: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { submitPipelineJob, listPipelineJobs, markJobSold } from "../pipeline";

const AGENT = "a".repeat(64);
const DIGEST = "d".repeat(64);
const base = { jobId: "job-1", agentCommitment: AGENT, pipeline: "pdf_to_markdown", inputRef: "s3://x.pdf", outputDigest: DIGEST };

describe("pipeline runner", () => {
  beforeEach(() => vi.clearAllMocks());

  it("submits a valid job", async () => {
    prismaMock.pipelineJob.findUnique.mockResolvedValue(null);
    prismaMock.pipelineJob.create.mockResolvedValue({ jobId: "job-1", status: "SUBMITTED" });
    const r = await submitPipelineJob(base);
    expect(r).toMatchObject({ ok: true, jobId: "job-1", status: "SUBMITTED", deduped: false });
    expect(prismaMock.pipelineJob.create).toHaveBeenCalled();
  });

  it("is idempotent on jobId", async () => {
    prismaMock.pipelineJob.findUnique.mockResolvedValue({ jobId: "job-1", status: "SOLD" });
    const r = await submitPipelineJob(base);
    expect(r).toMatchObject({ ok: true, status: "SOLD", deduped: true });
    expect(prismaMock.pipelineJob.create).not.toHaveBeenCalled();
  });

  it("validates the shape", async () => {
    expect(await submitPipelineJob({ ...base, jobId: "bad id" })).toMatchObject({ ok: false, code: "invalid_job_id" });
    expect(await submitPipelineJob({ ...base, agentCommitment: "nope" })).toMatchObject({ ok: false, code: "invalid_commitment" });
    expect(await submitPipelineJob({ ...base, outputDigest: "short" })).toMatchObject({ ok: false, code: "invalid_output_digest" });
  });

  it("lists jobs for an agent", async () => {
    prismaMock.pipelineJob.findMany.mockResolvedValue([]);
    await listPipelineJobs(AGENT, { status: "sold" });
    const where = prismaMock.pipelineJob.findMany.mock.calls[0][0].where;
    expect(where.agentCommitment).toBe(AGENT);
    expect(where.status).toBe("SOLD");
  });

  it("markJobSold updates only a SUBMITTED job", async () => {
    prismaMock.pipelineJob.updateMany.mockResolvedValue({ count: 1 });
    expect(await markJobSold(prismaMock as never, "job-1", "inv_1")).toBe(true);
    const where = prismaMock.pipelineJob.updateMany.mock.calls[0][0].where;
    expect(where).toEqual({ jobId: "job-1", status: "SUBMITTED" });
  });
});
