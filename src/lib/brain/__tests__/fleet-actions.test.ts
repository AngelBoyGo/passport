import { beforeEach, describe, expect, it, vi } from "vitest";

const { mintMock, stopMock } = vi.hoisted(() => ({
  mintMock: vi.fn(),
  stopMock: vi.fn(),
}));

vi.mock("@/lib/fleet/fleet-service", () => ({
  mintFleetAgent: mintMock,
  stopFleetAgent: stopMock,
  getFleetStatus: vi.fn(),
  fleetHalted: vi.fn(() => false),
  moneyMintEnabled: vi.fn(() => false),
  maxFleetAgents: vi.fn(() => 25),
}));

const { runScaleFleetUp, runRetireAgent } = await import("@/lib/brain/fleet-actions");

beforeEach(() => {
  mintMock.mockReset();
  stopMock.mockReset();
});

describe("brain fleet actions — SCALE_FLEET_UP", () => {
  it("mints one neuron agent and reports success (playbook-friendly)", async () => {
    mintMock.mockResolvedValue({ commitment: "a".repeat(64), tier: "neuron" });
    const result = await runScaleFleetUp({ capability: "locum_job_search", llm_tier: "neuron", count: 1 });
    expect(result).toBe("ok: created=1");
    expect(mintMock).toHaveBeenCalledTimes(1);
  });

  it("is bounded — a demanded count of 50 still only mints 3 per cycle", async () => {
    mintMock.mockResolvedValue({ commitment: "b".repeat(64), tier: "neuron" });
    const result = await runScaleFleetUp({ capability: "x", llm_tier: "neuron", count: 500 });
    expect(result).toBe("ok: created=3");
    expect(mintMock).toHaveBeenCalledTimes(3);
  });

  it("reports the SERVICE gate honestly when refused (money switch off)", async () => {
    mintMock.mockRejectedValue(new Error("money_tier_mint_disabled"));
    const result = await runScaleFleetUp({ capability: "money_ops", llm_tier: "money", count: 1 });
    expect(result).toBe("error: money_tier_mint_disabled");
  });

  it("an unknown tier fails before any service call", async () => {
    const result = await runScaleFleetUp({ capability: "x", llm_tier: "gpt-4o-mini" });
    expect(result).toMatch(/unknown_llm_tier/);
    expect(mintMock).not.toHaveBeenCalled();
  });

  it("partial success is reported honestly (stop-on-first-error)", async () => {
    mintMock.mockResolvedValueOnce({ commitment: "c".repeat(64), tier: "neuron" });
    mintMock.mockRejectedValueOnce(new Error("fleet_cap_reached:25/25"));
    const result = await runScaleFleetUp({ capability: "x", llm_tier: "neuron", count: 2 });
    expect(result).toBe("ok: created=1 stopped_at=fleet_cap_reached:25/25");
  });
});

describe("brain fleet actions — RETIRE_AGENT", () => {
  it("stops the agent and keeps the reason trail", async () => {
    stopMock.mockResolvedValue(undefined);
    const result = await runRetireAgent({ commitment: "d".repeat(64), reason: "zero revenue" });
    expect(result).toBe("ok");
    expect(stopMock).toHaveBeenCalledWith("d".repeat(64), {
      reason: "brain_retire:zero revenue",
    });
  });

  it("refuses junk commitments", async () => {
    const result = await runRetireAgent({ commitment: "not-a-commitment" });
    expect(result).toBe("error: invalid_commitment");
    expect(stopMock).not.toHaveBeenCalled();
  });

  it("surfaces service refusals (already stopped, not found, illegal transition)", async () => {
    stopMock.mockRejectedValue(new Error("instance_already_stopped"));
    const result = await runRetireAgent({ commitment: "e".repeat(64) });
    expect(result).toBe("error: instance_already_stopped");
  });
});
