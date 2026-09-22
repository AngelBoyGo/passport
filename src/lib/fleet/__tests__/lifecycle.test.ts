import { describe, expect, it } from "vitest";
import {
  canTransition,
  isInstanceStatus,
  tierNotDowngraded,
  validateInstanceSpec,
} from "../lifecycle";

describe("lifecycle — legal transitions", () => {
  it("allows the provisioning ramp", () => {
    expect(canTransition("provisioning", "active")).toBe(true);
    expect(canTransition("provisioning", "failed")).toBe(true);
    expect(canTransition("active", "idle")).toBe(true);
    expect(canTransition("active", "stopped")).toBe(true);
    expect(canTransition("active", "failed")).toBe(true);
    expect(canTransition("idle", "active")).toBe(true);
    expect(canTransition("idle", "stopped")).toBe(true);
    expect(canTransition("stopped", "provisioning")).toBe(true);
    expect(canTransition("failed", "provisioning")).toBe(true);
  });

  it("a stuck provisioning/failed instance can be abandoned (stop)", () => {
    expect(canTransition("provisioning", "stopped")).toBe(true);
    expect(canTransition("failed", "stopped")).toBe(true);
  });

  it("REFUSES illegal transitions", () => {
    expect(canTransition("stopped", "active")).toBe(false);
    expect(canTransition("stopped", "failed")).toBe(false);
    expect(canTransition("active", "provisioning")).toBe(false);
    expect(canTransition("failed", "active")).toBe(false);
    expect(canTransition("provisioning", "idle")).toBe(false);
  });

  it("status guard rejects junk", () => {
    expect(isInstanceStatus("active")).toBe(true);
    expect(isInstanceStatus("running")).toBe(false);
  });
});

describe("lifecycle — upgrade-only tiers", () => {
  it("rejects a tier downgrade on re-provision", () => {
    expect(tierNotDowngraded("money", "neuron")).toBe(false);
    expect(tierNotDowngraded("neuron", "neuron")).toBe(true);
    expect(tierNotDowngraded("neuron", "money")).toBe(true);
  });
});

describe("lifecycle — spec validation", () => {
  it("accepts valid specs", () => {
    expect(validateInstanceSpec({ capability: "locum_job_search", llmTier: "neuron" })).toEqual({ ok: true });
  });

  it("rejects junk capability and missing tier", () => {
    expect(validateInstanceSpec({ capability: "", llmTier: "neuron" })).toMatchObject({ ok: false });
    expect(validateInstanceSpec({ capability: "bad path!", llmTier: "neuron" })).toMatchObject({ ok: false });
    // @ts-expect-error deliberate runtime violation
    expect(validateInstanceSpec({ capability: "x", llmTier: "gpt-4o-mini" })).toMatchObject({ ok: false });
  });
});
