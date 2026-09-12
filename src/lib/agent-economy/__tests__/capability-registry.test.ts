import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentCapability: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  normalizeCapabilityInput,
  declareCapability,
  listAgentCapabilities,
  discoverCapabilities,
  retireCapability,
} from "../capability-registry";

const AGENT = "a".repeat(64);

describe("capability registry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normalizes a valid declaration", () => {
    const r = normalizeCapabilityInput({
      capability: "Code-Generation",
      endpointUrl: "https://agent.example.com/rpc",
      priceAngel: 12.9,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.capability).toBe("code-generation");
      expect(r.value.priceAngel).toBe(12);
      expect(r.value.unit).toBe("task");
      expect(r.value.endpointUrl).toBe("https://agent.example.com/rpc");
      expect(r.value.active).toBe(true);
    }
  });

  it("rejects bad slugs, negative prices, and non-http URLs", () => {
    expect(normalizeCapabilityInput({ capability: "x" }).ok).toBe(false);
    expect(normalizeCapabilityInput({ capability: "has space", priceAngel: 1 }).ok).toBe(false);
    expect(normalizeCapabilityInput({ capability: "ok", priceAngel: -1 }).ok).toBe(false);
    expect(normalizeCapabilityInput({ capability: "ok", endpointUrl: "ftp://x" }).ok).toBe(false);
  });

  it("declareCapability upserts on (agent, capability)", async () => {
    prismaMock.agentCapability.upsert.mockResolvedValue({ id: "cap_1" });
    await declareCapability(AGENT, { capability: "llm.inference", priceAngel: 5 });
    const call = prismaMock.agentCapability.upsert.mock.calls[0][0];
    expect(call.where.agentCommitment_capability).toEqual({
      agentCommitment: AGENT,
      capability: "llm.inference",
    });
    expect(call.create.priceAngel).toBe(5);
  });

  it("declareCapability throws on invalid input", async () => {
    await expect(declareCapability(AGENT, { capability: "bad slug" })).rejects.toThrow(/slug/);
  });

  it("lists active capabilities by default", async () => {
    prismaMock.agentCapability.findMany.mockResolvedValue([]);
    await listAgentCapabilities(AGENT);
    expect(prismaMock.agentCapability.findMany.mock.calls[0][0].where.active).toBe(true);
  });

  it("discovers by capability", async () => {
    prismaMock.agentCapability.findMany.mockResolvedValue([]);
    await discoverCapabilities({ capability: "LLM.Inference", limit: 10 });
    const where = prismaMock.agentCapability.findMany.mock.calls[0][0].where;
    expect(where.capability).toBe("llm.inference");
    expect(where.active).toBe(true);
  });

  it("retireCapability reports whether a row was deactivated", async () => {
    prismaMock.agentCapability.updateMany.mockResolvedValue({ count: 1 });
    expect(await retireCapability(AGENT, "llm.inference")).toBe(true);
    prismaMock.agentCapability.updateMany.mockResolvedValue({ count: 0 });
    expect(await retireCapability(AGENT, "llm.inference")).toBe(false);
  });
});
