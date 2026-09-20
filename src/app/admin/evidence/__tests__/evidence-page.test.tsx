import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import AdminEvidencePage from "@/app/admin/evidence/page";

const mockEvidenceData = {
  total: 2,
  sources: [
    { type: "otel_genai_trace", count: 1 },
    { type: "github_push_webhook", count: 1 },
  ],
  eventTypes: [
    { type: "AGENT_RUN_OBSERVED", count: 1 },
    { type: "AGENT_ARTIFACT_CREATED", count: 1 },
  ],
  evidence: [
    {
      id: "ev_1",
      sourceType: "otel_genai_trace",
      artifactType: "trace_span",
      normalizedEventType: "AGENT_RUN_OBSERVED",
      rawErrorClassification: null,
      observedAt: "2026-09-10T12:00:00.000Z",
      agentIdentityCommitment: "a".repeat(64),
      eventCommitmentHash: "ev_hash_1",
      validationSignalPresent: true,
      tokenUsageInput: 1500,
      tokenUsageOutput: 400,
      toolCallCount: 3,
      externalTaskId: "task-101",
      commitSha: null,
    },
    {
      id: "ev_2",
      sourceType: "github_push_webhook",
      artifactType: "commit",
      normalizedEventType: "AGENT_ARTIFACT_CREATED",
      rawErrorClassification: null,
      observedAt: "2026-09-11T14:30:00.000Z",
      agentIdentityCommitment: "command-brain",
      eventCommitmentHash: "ev_hash_2",
      validationSignalPresent: false,
      tokenUsageInput: null,
      tokenUsageOutput: null,
      toolCallCount: null,
      externalTaskId: null,
      commitSha: "abc1234",
    },
  ],
};

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : "";
    if (path.includes("/api/admin/evidence")) {
      return new Response(JSON.stringify(mockEvidenceData), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AdminEvidencePage", () => {
  it("renders evidence events table and badges", async () => {
    render(<AdminEvidencePage />);

    await waitFor(() => {
      expect(screen.getByText(/ev_hash_1/)).toBeInTheDocument();
    });

    expect(screen.getByText("AGENT RUN OBSERVED")).toBeInTheDocument();
    expect(screen.getByText("AGENT ARTIFACT CREATED")).toBeInTheDocument();
    expect(screen.getByText("command-brain")).toBeInTheDocument();
    expect(screen.getByText("✓ Attested")).toBeInTheDocument();
  });

  it("renders empty state when no evidence records exist", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ total: 0, sources: [], eventTypes: [], evidence: [] }), { status: 200 })
    );

    render(<AdminEvidencePage />);

    await waitFor(() => {
      expect(screen.getByText(/no evidence records found/i)).toBeInTheDocument();
    });
  });
});
