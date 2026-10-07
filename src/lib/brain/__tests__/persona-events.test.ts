import { describe, it, expect, afterEach } from "vitest";
import {
  emitPersonaPhase,
  subscribePersonaPhases,
  recentPersonaPhases,
  __resetPersonaBus,
  type PersonaPhaseEvent,
} from "../persona-events";

afterEach(() => __resetPersonaBus());

describe("persona phase bus", () => {
  it("buffers events and notifies subscribers", () => {
    const seen: PersonaPhaseEvent[] = [];
    const unsub = subscribePersonaPhases((e) => seen.push(e));

    emitPersonaPhase({ runId: "c1", persona: "mars", phase: "working", at: "t1" });
    expect(seen).toHaveLength(1);
    expect(recentPersonaPhases()).toHaveLength(1);

    unsub();
    emitPersonaPhase({ runId: "c1", persona: "mars", phase: "completed", at: "t2", ms: 10 });
    expect(seen).toHaveLength(1); // unsubscribed
    expect(recentPersonaPhases()).toHaveLength(2); // still buffered
  });

  it("keeps the buffer bounded", () => {
    for (let i = 0; i < 260; i++) {
      emitPersonaPhase({ runId: "c1", persona: "muse", phase: "working", at: `t${i}` });
    }
    expect(recentPersonaPhases().length).toBeLessThanOrEqual(200);
  });

  it("a throwing subscriber cannot break emission", () => {
    subscribePersonaPhases(() => {
      throw new Error("boom");
    });
    expect(() =>
      emitPersonaPhase({ runId: "c1", persona: "more", phase: "queued", at: "t" })
    ).not.toThrow();
    expect(recentPersonaPhases()).toHaveLength(1);
  });
});
