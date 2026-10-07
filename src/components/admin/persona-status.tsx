"use client";

import { useEffect, useState } from "react";
import { Orb } from "@yogesharc/thinking-orbs";
import type { OrbState } from "@yogesharc/thinking-orbs";
import type { PersonaDescriptor, DialogueTurnView } from "@/lib/brain/command-center-data";

/**
 * Coarse per-persona execution states. The backend emits no finer-grained
 * lifecycle events, so only states a real signal supports are produced by the
 * page: `idle`, `working` (a run is in flight), `completed`, and `failed`.
 * `queued`/`reasoning`/`searching`/`retrying`/`cancelled` exist for callers that
 * have a real signal and for tests — they are never inferred from silence.
 */
export type PersonaRunState =
  | "idle"
  | "queued"
  | "working"
  | "reasoning"
  | "searching"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled";

/** States that keep an animated orb. Everything else is a static indicator. */
const ACTIVE_STATES: readonly PersonaRunState[] = [
  "queued",
  "working",
  "reasoning",
  "searching",
  "retrying",
];

const ORB_STATE: Record<PersonaRunState, OrbState> = {
  idle: "base",
  queued: "waiting",
  working: "working",
  reasoning: "reasoning",
  searching: "searching",
  retrying: "retrying",
  completed: "base",
  failed: "base",
  cancelled: "base",
};

const STATUS_LABEL: Record<PersonaRunState, string> = {
  idle: "Idle",
  queued: "Queued",
  working: "Working",
  reasoning: "Reasoning",
  searching: "Searching",
  retrying: "Retrying",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<PersonaRunState, string> = {
  idle: "text-slate-500",
  queued: "text-amber-300",
  working: "text-indigo-300",
  reasoning: "text-indigo-300",
  searching: "text-cyan-300",
  retrying: "text-amber-300",
  completed: "text-emerald-400",
  failed: "text-red-400",
  cancelled: "text-slate-400",
};

const FAILURE_MARKERS = [
  "_unavailable",
  "failed",
  "no_valid_steps",
  "draft_empty",
  "low_confidence",
];

/** A persisted turn is a failure when the dialogue recorded one explicitly. */
export function turnFailed(content: string): boolean {
  const c = content.toLowerCase();
  return FAILURE_MARKERS.some((m) => c.includes(m));
}

export interface PersonaStateInput {
  /** True while a cycle is executing (a real in-flight signal). */
  active: boolean;
  /** Cycle-level error message, when the run failed as a whole. */
  error?: string | null;
  /** Persisted turns of the run being shown. */
  turns: DialogueTurnView[];
}

/**
 * Maps a persona + the real run signals onto a coarse state. The Brain row is
 * the orchestrator: it is Working while a run is in flight and Completed once
 * any turn was persisted. Never invents Reasoning/Searching/etc.
 */
export function derivePersonaState(
  persona: PersonaDescriptor,
  { active, error, turns }: PersonaStateInput
): { state: PersonaRunState; turn: DialogueTurnView | null } {
  const turn = turns.find((t) => t.persona === persona.id) ?? null;
  if (active) return { state: "working", turn };
  if (turn) return { state: turnFailed(turn.content) ? "failed" : "completed", turn };
  if (persona.id === "brain" && turns.length > 0) {
    return { state: turns.some((t) => turnFailed(t.content)) ? "failed" : "completed", turn: null };
  }
  if (error) return { state: "failed", turn: null };
  return { state: "idle", turn: null };
}

export interface RunScope {
  runId: string | null;
  at: string | null;
  turns: DialogueTurnView[];
}

/**
 * Guards against a stale event from an earlier run overwriting a newer one.
 * Same run refreshes in place; a different run is accepted only when it is not
 * older than the current one (by completion time).
 */
export function acceptRun(current: RunScope, incoming: RunScope): RunScope {
  if (!incoming.runId) return current;
  if (current.runId === incoming.runId) return incoming;
  if (!current.runId || !current.at) return incoming;
  if (!incoming.at) return current;
  return new Date(incoming.at).getTime() >= new Date(current.at).getTime() ? incoming : current;
}

/** Library holds still under reduced motion; we also pass `paused` explicitly. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);
  return reduced;
}

/**
 * Elapsed run time. Ticks once a second only while a run is active, and freezes
 * at the terminal value (endedAt) once it is not. Cleaned up on unmount; never
 * placed in a live region, so it is not announced continuously.
 */
export function useElapsedMs(
  startedAt: number | null,
  endedAt: number | null,
  active: boolean
): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt == null || endedAt != null || !active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt, endedAt, active]);
  if (startedAt == null) return null;
  const end = endedAt ?? (active ? now : startedAt);
  return Math.max(0, end - startedAt);
}

function TerminalIcon({ state }: { state: PersonaRunState }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (state === "completed") {
    return (
      <svg {...common} className="shrink-0">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (state === "failed") {
    return (
      <svg {...common} className="shrink-0">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    );
  }
  return (
    <svg {...common} className="shrink-0">
      <circle cx="12" cy="12" r="9" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

/** Decorative: the adjacent, visible status word carries the meaning for AT. */
function Indicator({ state, paused }: { state: PersonaRunState; paused: boolean }) {
  const tone = STATUS_TONE[state];
  if (ACTIVE_STATES.includes(state)) {
    return (
      <Orb
        state={ORB_STATE[state]}
        size={20}
        paused={paused}
        className={`shrink-0 ${tone}`}
      />
    );
  }
  if (state === "idle") {
    return <Orb state="base" size={20} paused className={`shrink-0 ${tone}`} />;
  }
  return (
    <span className={tone}>
      <TerminalIcon state={state} />
    </span>
  );
}

function Preview({ content }: { content: string }) {
  const clean = content.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const truncated = clean.length > 120;
  if (!truncated) {
    return <p className="truncate text-[11px] text-slate-400">{clean}</p>;
  }
  return (
    <details className="min-w-0 text-[11px] text-slate-400">
      <summary className="cursor-pointer truncate marker:text-slate-600">
        {clean.slice(0, 120)}…
      </summary>
      <p className="mt-1 whitespace-pre-wrap break-words text-slate-300">{clean}</p>
    </details>
  );
}

export interface PersonaStatusPanelProps {
  personas: PersonaDescriptor[];
  turns: DialogueTurnView[];
  runId?: string | null;
  active?: boolean;
  error?: string | null;
  startedAt?: number | null;
  endedAt?: number | null;
  /**
   * Optional explicit state per persona id, for callers that hold a real signal
   * the coarse derivation cannot see (e.g. a genuine Queued or Cancelled event).
   * Omitted for a persona, the coarse derivation is used.
   */
  states?: Partial<Record<string, PersonaRunState>>;
}

export function PersonaStatusPanel({
  personas,
  turns,
  runId = null,
  active = false,
  error = null,
  startedAt = null,
  endedAt = null,
  states,
}: PersonaStatusPanelProps) {
  const reduced = usePrefersReducedMotion();
  const elapsedMs = useElapsedMs(startedAt, endedAt, active);

  return (
    <section
      aria-label="Persona status"
      className="rounded-2xl border border-white/10 bg-[#0e131d] p-5 shadow-xl"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
          Persona Status
        </h2>
        <span className="font-mono text-[10px] text-slate-500">
          {runId ? `run ${runId}` : "no run yet"}
        </span>
      </div>

      <div className="divide-y divide-white/5">
        {personas.map((p) => {
          const derived = derivePersonaState(p, { active, error, turns });
          const state = states?.[p.id] ?? derived.state;
          const turn = derived.turn;
          // Prefer the persona's OWN turn duration (real per-turn timing); fall
          // back to the run-level elapsed while active / on completion.
          const rowElapsedMs =
            turn?.ms ?? (state === "working" || state === "completed" ? elapsedMs : null);
          return (
            <div
              key={p.id}
              className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="flex min-w-0 items-center gap-2.5 sm:w-64 sm:shrink-0">
                <Indicator state={state} paused={reduced} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-white">{p.name}</span>
                    <span className={`text-xs ${STATUS_TONE[state]}`}>{STATUS_LABEL[state]}</span>
                  </div>
                  <div
                    className="truncate font-mono text-[11px] text-slate-500"
                    title={p.model}
                  >
                    {p.model}
                    {p.local && <span className="ml-1 text-emerald-400">(local)</span>}
                  </div>
                </div>
              </div>

              <div className="flex min-w-0 items-center gap-3 sm:flex-1">
                {rowElapsedMs != null && (
                  <span className="shrink-0 font-mono text-[11px] text-slate-400">
                    {(rowElapsedMs / 1000).toFixed(1)}s
                  </span>
                )}
                {turn ? (
                  <Preview content={turn.content} />
                ) : (
                  <span className="text-[11px] text-slate-600">
                    {state === "idle" ? "No activity in the latest run." : ""}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
