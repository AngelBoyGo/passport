import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import TraceDetailPage from "@/app/trace/[id]/page";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentEvidence: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

describe("TraceDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders trace details when evidence is found", async () => {
    prismaMock.agentEvidence.findFirst.mockResolvedValue({
      id: "ev_test_1",
      sourceType: "otel_genai_trace",
      artifactType: "trace_span",
      normalizedEventType: "AGENT_RUN_OBSERVED",
      rawErrorClassification: null,
      observedAt: new Date("2026-09-15T12:00:00Z"),
      agentIdentityCommitment: "a".repeat(64),
      eventCommitmentHash: "sha256_event_hash_123",
      sourceDigest: JSON.stringify({ query: "compute_optimal", score: 0.95 }),
      validationSignalPresent: true,
      tokenUsageInput: 1200,
      tokenUsageOutput: 350,
      toolCallCount: 2,
      executionStartedAt: new Date("2026-09-15T12:00:00Z"),
      executionFinishedAt: new Date("2026-09-15T12:00:03Z"),
      externalTaskId: "task-99",
      commitSha: "c123456",
      repositoryCommitment: "repo_commit",
      sourceUrl: "https://github.com/example/repo",
      evidenceReceiptLinks: [
        {
          id: "link_1",
          receiptId: "rcpt_99",
          linkageType: "OBSERVATION",
          enforcementState: "ENFORCEMENT_ELIGIBLE",
        },
      ],
    });

    const jsx = await TraceDetailPage({
      params: Promise.resolve({ id: "ev_test_1" }),
    });

    render(jsx);

    expect(screen.getByText(/sha256_event_hash_123/)).toBeInTheDocument();
    expect(screen.getByText("AGENT RUN OBSERVED")).toBeInTheDocument();
    expect(screen.getByText("otel_genai_trace")).toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(screen.getByText("350")).toBeInTheDocument();
    expect(screen.getByText("task-99")).toBeInTheDocument();
    expect(screen.getByText("rcpt_99")).toBeInTheDocument();
  });

  it("renders not found state when evidence does not exist", async () => {
    prismaMock.agentEvidence.findFirst.mockResolvedValue(null);

    const jsx = await TraceDetailPage({
      params: Promise.resolve({ id: "unknown_id" }),
    });

    render(jsx);

    expect(screen.getByText(/Trace Record Not Found/i)).toBeInTheDocument();
    expect(screen.getByText("unknown_id")).toBeInTheDocument();
  });
});
