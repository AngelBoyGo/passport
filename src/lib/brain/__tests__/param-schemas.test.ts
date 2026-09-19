import { describe, it, expect } from "vitest";
import { validateActionParams } from "../param-schemas";
import { BRAIN_ACTIONS } from "../command-brain";

describe("validateActionParams", () => {
  it("accepts empty params for RUN_TICK", () => {
    expect(validateActionParams("RUN_TICK", {})).toEqual({ ok: true, params: {} });
  });

  it("rejects unknown keys (strict schemas)", () => {
    const r = validateActionParams("RUN_TICK", { evil: "payload" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("invalid params for RUN_TICK");
  });

  it("rejects QUARANTINE_RAIL without rail_key", () => {
    const r = validateActionParams("QUARANTINE_RAIL", { reason: "no key" });
    expect(r.ok).toBe(false);
  });

  it("accepts QUARANTINE_RAIL with rail_key and cleans extra-free params", () => {
    const r = validateActionParams("QUARANTINE_RAIL", { rail_key: "rail-1", reason: "velocity burst" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.params).toEqual({ rail_key: "rail-1", reason: "velocity burst" });
  });

  it("rejects QUARANTINE_RAIL with overlong reason", () => {
    const r = validateActionParams("QUARANTINE_RAIL", { rail_key: "rail-1", reason: "x".repeat(501) });
    expect(r.ok).toBe(false);
  });

  it("accepts RECORD_NOTE with optional note", () => {
    expect(validateActionParams("RECORD_NOTE", { note: "observed drift" }).ok).toBe(true);
    expect(validateActionParams("RECORD_NOTE", {}).ok).toBe(true);
  });

  it("accepts RUN_RESEARCH_SCAN with optional focus", () => {
    expect(validateActionParams("RUN_RESEARCH_SCAN", { focus: "disputes" }).ok).toBe(true);
    expect(validateActionParams("RUN_RESEARCH_SCAN", {}).ok).toBe(true);
  });

  it("every allowlisted action has a param schema", () => {
    for (const action of BRAIN_ACTIONS) {
      expect(validateActionParams(action as never, {})).toBeDefined();
    }
  });
});