import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ExecutiveDashboard } from "@/components/admin/executive-dashboard";

const mockOverviewData = {
  generatedAt: "2026-08-19T00:00:00.000Z",
  executiveAdmin: true,
  operator: {
    email: "ceo@example.com",
    tier: "pro",
    credits: 9800,
    accountStatus: "ACTIVE",
    stakeBalanceCents: 5000,
  },
  metrics: {
    receipts: 142,
    receiptsToday: 12,
    issuedAgents: 8,
    evidence: 35,
    engagements: 4,
    slashingEvents: 1,
    slashedCents: 2500,
  },
  health: {
    overall: "operational",
    components: [
      { id: "database", label: "PostgreSQL", status: "operational", detail: "2ms" },
      { id: "signing", label: "Receipt signing", status: "operational", detail: "Ed25519 key loaded" },
      { id: "ingestion", label: "Evidence ingestion", status: "operational", detail: "Salt loaded" },
      { id: "api", label: "Public API", status: "operational", detail: "Responding" },
    ],
  },
  activity: [
    { type: "receipt", label: "success competence receipt", detail: "rcpt_123", at: "2026-08-19T00:00:00.000Z", href: "/verify/rcpt_123" },
    { type: "evidence", label: "github_commit_payload evidence", detail: "AGENT_ARTIFACT_CREATED", at: "2026-08-19T00:00:00.000Z", href: "/profiles/abc" },
  ],
  copilotContext: { view: "command-center" },
  publicKey: "54b38000c534187cfd5fc6d3a41a8614e7c59ef67d83078b5aa18d2374b4f081",
};

describe("ExecutiveDashboard tab switching", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/admin");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const path = typeof url === "string" ? url : (url as URL).pathname;
      if (path.includes("/api/admin/overview")) {
        return new Response(JSON.stringify(mockOverviewData), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders Command Center tab by default", async () => {
    render(<ExecutiveDashboard />);
    await waitFor(() => {
      expect(screen.getByText("Operating posture")).toBeInTheDocument();
    });
    expect(screen.getByText("Executive Copilot")).toBeInTheDocument();
  });

  it("switches to Trust Operations tab when clicked", async () => {
    render(<ExecutiveDashboard />);
    await waitFor(() => {
      expect(screen.getByText("Operating posture")).toBeInTheDocument();
    });

    const trustTabs = screen.getAllByRole("tab", { name: /Trust Operations/i });
    fireEvent.click(trustTabs[0]);

    await waitFor(() => {
      expect(screen.getByText("Enrollment pipeline")).toBeInTheDocument();
    });
    expect(screen.getByText("Enroll a new agent →")).toBeInTheDocument();
  });

  it("switches to Economy tab when clicked", async () => {
    render(<ExecutiveDashboard />);
    await waitFor(() => {
      expect(screen.getByText("Operating posture")).toBeInTheDocument();
    });

    const economyTabs = screen.getAllByRole("tab", { name: /Economy/i });
    fireEvent.click(economyTabs[0]);

    await waitFor(() => {
      expect(screen.getByText("Account balance")).toBeInTheDocument();
    });
    expect(screen.getByText("Engagement lifecycle")).toBeInTheDocument();
    expect(screen.getByText(/Minimum \$50 escrow/i)).toBeInTheDocument();
  });

  it("switches to Reliability tab when clicked", async () => {
    render(<ExecutiveDashboard />);
    await waitFor(() => {
      expect(screen.getByText("Operating posture")).toBeInTheDocument();
    });

    const reliabilityTabs = screen.getAllByRole("tab", { name: /Reliability/i });
    fireEvent.click(reliabilityTabs[0]);

    await waitFor(() => {
      expect(screen.getByText("Reliability checkpoints")).toBeInTheDocument();
    });
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
    expect(screen.getByText("Receipt signing")).toBeInTheDocument();
  });
});
