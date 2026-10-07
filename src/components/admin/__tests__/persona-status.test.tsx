import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor, renderHook, act } from "@testing-library/react";

vi.mock("@yogesharc/thinking-orbs", () => ({
  Orb: ({
    state,
    paused,
    className,
  }: {
    state: string;
    paused?: boolean;
    className?: string;
  }) => (
    <span
      data-testid="orb"
      data-state={state}
      data-paused={String(Boolean(paused))}
      className={className}
    />
  ),
}));

import {
  PersonaStatusPanel,
  derivePersonaState,
  acceptRun,
  turnFailed,
  usePrefersReducedMotion,
} from "../persona-status";
import type { PersonaDescriptor, DialogueTurnView } from "@/lib/brain/command-center-data";

const personas: PersonaDescriptor[] = [
  { id: "mars", name: "MARS", tier: "cortex", model: "deepseek/deepseek-v4.1-flash", local: false },
  { id: "muse", name: "MUSE", tier: "cortex", model: "z-ai/glm-5.3-flash", local: false },
  { id: "more", name: "MORE", tier: "local", model: "gemma4-31b-heretic-64k", local: true },
  { id: "brain", name: "Brain", tier: "neuron", model: "deepseek/deepseek-v4.1-flash", local: false },
];

function turn(over: Partial<DialogueTurnView>): DialogueTurnView {
  return { persona: "muse", role: "draft", content: "[]", confidence: 80, ms: null, ...over };
}

function mockMatchMedia(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  mockMatchMedia(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("turnFailed", () => {
  it("flags explicit dialogue failures and passes normal content", () => {
    expect(turnFailed("critique_unavailable:timeout")).toBe(true);
    expect(turnFailed("no_valid_steps_after_vetting")).toBe(true);
    expect(turnFailed("draft_failed:boom")).toBe(true);
    expect(turnFailed('{"steps":[],"confidence":85}')).toBe(false);
  });
});

describe("derivePersonaState", () => {
  it("is idle with no run signals", () => {
    expect(derivePersonaState(personas[0], { active: false, turns: [] }).state).toBe("idle");
  });

  it("is working while a run is in flight", () => {
    expect(derivePersonaState(personas[0], { active: true, turns: [] }).state).toBe("working");
  });

  it("is completed when the persona has a turn, failed when the turn failed", () => {
    expect(
      derivePersonaState(personas[0], { active: false, turns: [turn({ persona: "mars" })] }).state
    ).toBe("completed");
    expect(
      derivePersonaState(personas[0], {
        active: false,
        turns: [turn({ persona: "mars", content: "draft_failed:x" })],
      }).state
    ).toBe("failed");
  });

  it("the Brain row completes once any turn is persisted", () => {
    const brain = personas.find((p) => p.id === "brain")!;
    expect(derivePersonaState(brain, { active: false, turns: [turn({ persona: "muse" })] }).state).toBe(
      "completed"
    );
  });

  it("fails the whole run when a cycle-level error is present", () => {
    expect(derivePersonaState(personas[0], { active: false, error: "HTTP 500", turns: [] }).state).toBe(
      "failed"
    );
  });
});

describe("acceptRun — stale-run guard", () => {
  it("refreshes the same run in place", () => {
    const current = { runId: "c1", at: "2026-10-07T00:00:10Z", turns: [turn({ persona: "mars" })] };
    const incoming = { ...current, turns: [turn({ persona: "mars" }), turn({ persona: "muse" })] };
    expect(acceptRun(current, incoming)).toBe(incoming);
  });

  it("rejects an older run's late event", () => {
    const current = { runId: "c2", at: "2026-10-07T00:10:00Z", turns: [] };
    const stale = { runId: "c1", at: "2026-10-07T00:00:00Z", turns: [turn({})] };
    expect(acceptRun(current, stale)).toBe(current);
  });

  it("accepts a newer run", () => {
    const current = { runId: "c1", at: "2026-10-07T00:00:00Z", turns: [] };
    const newer = { runId: "c2", at: "2026-10-07T00:10:00Z", turns: [turn({})] };
    expect(acceptRun(current, newer)).toBe(newer);
  });

  it("ignores an event with no run id", () => {
    const current = { runId: "c1", at: "2026-10-07T00:00:00Z", turns: [] };
    expect(acceptRun(current, { runId: null, at: null, turns: [turn({})] })).toBe(current);
  });
});

describe("PersonaStatusPanel — rendering", () => {
  it("renders Idle for every persona before any run", () => {
    render(<PersonaStatusPanel personas={personas} turns={[]} />);
    expect(screen.getAllByText("Idle")).toHaveLength(4);
    expect(screen.getByText("no run yet")).toBeInTheDocument();
  });

  it("maps queued -> working orb states from real signals", () => {
    const { container } = render(
      <PersonaStatusPanel
        personas={personas}
        turns={[]}
        active
        states={{ mars: "queued", muse: "working", more: "reasoning", brain: "searching" }}
      />
    );
    const orbs = container.querySelectorAll('[data-testid="orb"]');
    const states = Array.from(orbs).map((o) => o.getAttribute("data-state"));
    expect(states).toEqual(["waiting", "working", "reasoning", "searching"]);
    expect(screen.getAllByText("Queued")).toHaveLength(1);
    expect(screen.getAllByText("Working")).toHaveLength(1);
  });

  it("shows a static check for completed and a static error for failed", () => {
    render(
      <PersonaStatusPanel
        personas={personas}
        turns={[
          turn({ persona: "mars", content: "critique_unavailable:timeout" }),
          turn({ persona: "muse", content: '{"steps":[]}' }),
        ]}
        runId="c9"
      />
    );
    expect(screen.getAllByText("Failed").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Completed").length).toBe(1);
    expect(screen.getByText("run c9")).toBeInTheDocument();
    // No animated (active) orbs: failed/completed are static, and the only orb
    // left is the idle MORE (base, paused).
    const orbs = screen.queryAllByTestId("orb");
    expect(orbs.every((o) => o.getAttribute("data-state") === "base")).toBe(true);
  });

  it("supports concurrent personas with different states", () => {
    render(
      <PersonaStatusPanel
        personas={personas}
        turns={[turn({ persona: "muse", content: '{"steps":[]}' })]}
      />
    );
    // MUSE and the Brain both completed; MARS and MORE are idle.
    expect(screen.getAllByText("Completed")).toHaveLength(2);
    expect(screen.getAllByText("Idle")).toHaveLength(2);
  });

  it("shows cancellation with a neutral static indicator", () => {
    render(
      <PersonaStatusPanel personas={personas} turns={[]} states={{ mars: "cancelled" }} />
    );
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });
});

describe("PersonaStatusPanel — labels", () => {
  it("shows the exact model id and MORE's (local) designation", () => {
    render(<PersonaStatusPanel personas={personas} turns={[]} />);
    expect(screen.getByText(/z-ai\/glm-5.3-flash/)).toBeInTheDocument();
    expect(screen.getAllByText(/deepseek\/deepseek-v4.1-flash/).length).toBe(2);
    expect(screen.getByText("(local)")).toBeInTheDocument();
  });
});

describe("PersonaStatusPanel — previews", () => {
  it("renders short previews as plain text", () => {
    const { container } = render(
      <PersonaStatusPanel personas={personas} turns={[turn({ content: "short note" })]} />
    );
    expect(screen.getByText("short note")).toBeInTheDocument();
    expect(container.querySelector("details")).toBeNull();
  });

  it("truncates long previews into an expandable details element", () => {
    const long = "x".repeat(400);
    const { container } = render(
      <PersonaStatusPanel personas={personas} turns={[turn({ content: long })]} />
    );
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    const summary = details!.querySelector("summary")!;
    expect(summary.textContent!.endsWith("…")).toBe(true);
    expect(summary.textContent!.length).toBeLessThan(long.length);
  });
});

describe("PersonaStatusPanel — elapsed time", () => {
  it("shows the persona's own turn duration when recorded", () => {
    render(<PersonaStatusPanel personas={personas} turns={[turn({ persona: "mars", ms: 9700 })]} />);
    expect(screen.getByText("9.7s")).toBeInTheDocument();
  });

  it("shows frozen elapsed time at a terminal state", () => {
    const start = Date.now();
    render(
      <PersonaStatusPanel
        personas={personas}
        turns={[turn({ persona: "mars" })]}
        startedAt={start}
        endedAt={start + 9700}
      />
    );
    expect(screen.getAllByText("9.7s").length).toBeGreaterThanOrEqual(1);
  });

  it("ticks while active and stops when the run ends", () => {
    vi.useFakeTimers();
    const start = Date.now();
    const { rerender } = render(
      <PersonaStatusPanel personas={personas} turns={[]} active startedAt={start} />
    );
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getAllByText("2.0s").length).toBeGreaterThanOrEqual(1);

    rerender(
      <PersonaStatusPanel
        personas={personas}
        turns={[turn({ persona: "mars" })]}
        active={false}
        startedAt={start}
        endedAt={start + 2000}
      />
    );
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getAllByText("2.0s").length).toBeGreaterThanOrEqual(1);
  });
});

describe("usePrefersReducedMotion + paused orbs", () => {
  it("detects the reduced-motion media query", async () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => usePrefersReducedMotion());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("pauses active orbs under reduced motion", async () => {
    mockMatchMedia(true);
    const { container } = render(
      <PersonaStatusPanel personas={personas} turns={[]} active />
    );
    await waitFor(() => {
      const orb = container.querySelector('[data-testid="orb"]');
      expect(orb?.getAttribute("data-paused")).toBe("true");
    });
  });
});
