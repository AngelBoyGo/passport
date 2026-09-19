import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import AdminBrainPage from "@/app/admin/brain/page";

const brainData = {
  success: true,
  executiveAdmin: true,
  current_run: {
    last_observation: { cycle_id: "c1", summary: "health=1 integrity=true disputes=0", at: new Date().toISOString() },
    last_decision: {
      cycle_id: "c1",
      action: "RUN_RESEARCH_SCAN",
      rationale: "Research is stale; running the internal scan.",
      at: new Date().toISOString(),
    },
    last_outcome: { cycle_id: "c1", action: "RUN_RESEARCH_SCAN", result: "ok: findings=2", at: new Date().toISOString() },
    health_trajectory: [
      { at: new Date().toISOString(), health: 0.9 },
      { at: new Date().toISOString(), health: 1 },
    ],
  },
  impact: {
    recent_attributions: [
      {
        cycle_id: "c0",
        action: "TRIGGER_ATTESTATION",
        delta: 0.2,
        result: "POSITIVE",
        confidence: 1,
        confounders: [],
        at: new Date().toISOString(),
      },
    ],
  },
  learning: {
    proposals_by_status: { PROPOSED: 1 },
    canary: null,
  },
  safety: {
    action_allowlist: ["NOOP", "RUN_RESEARCH_SCAN"],
    money_moving_actions: 0,
    outcomes_24h_by_class: { "ok": 3 },
    memory_rows_by_kind: { OBSERVATION: 3, OUTCOME: 3 },
  },
  timestamp: new Date().toISOString(),
};

const proposalsData = {
  success: true,
  count: 1,
  proposals: [
    {
      proposal_id: "prop_1",
      objective: "Raise attestation threshold",
      expected_improvement: "fewer attestations",
      risk_class: "low",
      status: "PROPOSED",
      replay_score: null,
      approved_by: null,
      approved_at: null,
      created_at: new Date().toISOString(),
    },
  ],
};

function mockFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : "";
    if (path.includes("/api/admin/brain/proposals")) {
      return new Response(JSON.stringify(proposalsData), { status: 200 });
    }
    if (path.includes("/api/admin/brain")) {
      return new Response(JSON.stringify(brainData), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  });
}

beforeEach(() => {
  mockFetch();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AdminBrainPage (executive session)", () => {
  it("renders the brain snapshot: run, attribution, safety", async () => {
    render(<AdminBrainPage />);

    await waitFor(() => {
      expect(screen.getByText(/health=1 integrity=true disputes=0/)).toBeInTheDocument();
    });
    expect(screen.getAllByText("RUN_RESEARCH_SCAN").length).toBeGreaterThan(0);
    expect(screen.getByText("POSITIVE")).toBeInTheDocument();
    expect(screen.getByText(/money-moving actions: 0/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Raise attestation threshold/)).toBeInTheDocument();
    });
  });

  it("offers the next legal transition for a PROPOSED row", async () => {
    render(<AdminBrainPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /replay vs history/i })).toBeInTheDocument();
    });
  });

  it("confirms then POSTs a transition to the admin steering endpoint", async () => {
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    render(<AdminBrainPage />);

    const btn = await screen.findByRole("button", { name: /replay vs history/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/admin/brain/proposals/prop_1",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("replay"),
        })
      );
    });
  });

  it("does not POST when the operator declines the confirmation", async () => {
    const spy = mockFetch();
    render(<AdminBrainPage />);
    const btn = await screen.findByRole("button", { name: /replay vs history/i });
    fireEvent.click(btn);
    expect(spy).not.toHaveBeenCalledWith(
      "/api/admin/brain/proposals/prop_1",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("shows the executive-access error on 403", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 })
    );
    render(<AdminBrainPage />);
    await waitFor(() => {
      expect(screen.getByText(/executive admin access required/i)).toBeInTheDocument();
    });
  });

  it("shows the empty-state guidance before attributions exist", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : "";
      if (path.includes("/api/admin/brain/proposals")) {
        return new Response(JSON.stringify({ success: true, count: 0, proposals: [] }), { status: 200 });
      }
      if (path.includes("/api/admin/brain")) {
        return new Response(
          JSON.stringify({
            ...brainData,
            impact: { recent_attributions: [] },
            learning: { proposals_by_status: {}, canary: null },
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    });
    render(<AdminBrainPage />);
    await waitFor(() => {
      expect(screen.getByText(/no attributions yet/i)).toBeInTheDocument();
    });
  });
});