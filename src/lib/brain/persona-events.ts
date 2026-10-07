/**
 * In-process persona lifecycle bus.
 *
 * The two-persona dialogue runs server-side (cron or the Telegram /plan path).
 * Before this bus there was NO live per-persona signal — the UI could only show
 * coarse states from persisted turns. The dialogue now emits REAL phase events
 * as it runs, and the admin SSE stream forwards them to the browser.
 *
 * Only phases we can actually observe are emitted: queued (before a persona's
 * turn), working (the model call is in flight), completed / failed (with the
 * measured duration). We never fabricate "reasoning"/"searching"/"retrying" —
 * those are not observable without instrumenting the gateway retry loop.
 *
 * State lives on globalThis so the scheduler bundle and the route-handler bundle
 * share ONE bus (module-level singletons are duplicated across Next chunks).
 */

export type PersonaPhase =
  | "queued"
  | "working"
  | "reasoning"
  | "searching"
  | "retrying"
  | "completed"
  | "failed";

export interface PersonaPhaseEvent {
  runId: string;
  persona: string;
  phase: PersonaPhase;
  at: string;
  ms?: number;
  detail?: string;
}

type Listener = (event: PersonaPhaseEvent) => void;

interface PersonaBus {
  buffer: PersonaPhaseEvent[];
  listeners: Set<Listener>;
}

const MAX_BUFFER = 200;

function bus(): PersonaBus {
  const g = globalThis as unknown as { __passportPersonaBus?: PersonaBus };
  if (!g.__passportPersonaBus) {
    g.__passportPersonaBus = { buffer: [], listeners: new Set() };
  }
  return g.__passportPersonaBus;
}

export function emitPersonaPhase(event: PersonaPhaseEvent): void {
  const b = bus();
  b.buffer.push(event);
  if (b.buffer.length > MAX_BUFFER) b.buffer.splice(0, b.buffer.length - MAX_BUFFER);
  for (const listener of b.listeners) {
    try {
      listener(event);
    } catch {
      // A misbehaving subscriber must never break the dialogue.
    }
  }
}

export function subscribePersonaPhases(listener: Listener): () => void {
  const b = bus();
  b.listeners.add(listener);
  return () => {
    b.listeners.delete(listener);
  };
}

export function recentPersonaPhases(): PersonaPhaseEvent[] {
  return bus().buffer.slice();
}

/** Test helper: drop all buffered events + listeners. */
export function __resetPersonaBus(): void {
  const b = bus();
  b.buffer.length = 0;
  b.listeners.clear();
}
