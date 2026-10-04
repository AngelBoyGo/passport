import { describe, expect, it, vi } from "vitest";
import { completeTierResilient, type TierCompleteOptions } from "../gateway-client";
import { TIER_MODEL_ALLOWLIST } from "../tiers";

/** Builds a fake fetch that returns queued responses in order. */
function fakeFetch(queue: Array<{ status?: number; body?: unknown; text?: string; throws?: boolean }>) {
  const calls: string[] = [];
  const fn = vi.fn(async (_url: string, init: { body: string }) => {
    const model = JSON.parse(init.body).model as string;
    calls.push(model);
    const next = queue.shift();
    if (!next) throw new Error("fakeFetch queue exhausted");
    if (next.throws) throw new Error("network error");
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => next.text ?? "",
      json: async () => next.body ?? {},
    } as unknown as Response;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const ok = (content: string) => ({ status: 200, body: { choices: [{ message: { content } }] } });
const empty = () => ({ status: 200, body: { choices: [{ message: { content: "" } }] } });
const http500 = () => ({ status: 500, text: "server error" });

const CFG = { baseUrl: "https://gw.test/v1", apiKey: "k" };
const opts: TierCompleteOptions = { system: "s", user: "u" };

describe("completeTierResilient — retry + same-tier fallback", () => {
  it("returns immediately on first success (no extra calls)", async () => {
    const { fn, calls } = fakeFetch([ok("hello")]);
    const out = await completeTierResilient("neuron", opts, { config: CFG, fetchImpl: fn });
    expect(out).toBe("hello");
    expect(calls).toHaveLength(1);
  });

  it("retries the SAME model on an empty completion, then succeeds", async () => {
    const { fn, calls } = fakeFetch([empty(), ok("second try")]);
    const out = await completeTierResilient("neuron", opts, {
      config: CFG,
      fetchImpl: fn,
      attemptsPerModel: 2,
      retryDelayMs: 0,
    });
    expect(out).toBe("second try");
    // both attempts used the same (default) model
    expect(new Set(calls).size).toBe(1);
  });

  it("falls back to a DIFFERENT allowlisted model after exhausting the primary", async () => {
    // primary (deepseek-v4-flash) fails twice; fallback (gpt-4o-mini) succeeds.
    const { fn, calls } = fakeFetch([empty(), empty(), ok("fallback model")]);
    const out = await completeTierResilient("neuron", opts, {
      config: CFG,
      fetchImpl: fn,
      attemptsPerModel: 2,
      retryDelayMs: 0,
    });
    expect(out).toBe("fallback model");
    expect(calls[0]).toBe(calls[1]); // primary retried
    expect(calls[2]).not.toBe(calls[0]); // fallback is a different model
    expect(TIER_MODEL_ALLOWLIST.neuron).toContain(calls[2]);
  });

  it("retries on 5xx and network errors", async () => {
    const { fn } = fakeFetch([http500(), { throws: true }, ok("recovered")]);
    const out = await completeTierResilient("neuron", opts, {
      config: CFG,
      fetchImpl: fn,
      attemptsPerModel: 3,
      retryDelayMs: 0,
    });
    expect(out).toBe("recovered");
  });

  it("throws (fail-closed) when every model and attempt fails", async () => {
    const { fn, calls } = fakeFetch([http500(), http500(), http500(), http500()]);
    await expect(
      completeTierResilient("neuron", opts, { config: CFG, fetchImpl: fn, attemptsPerModel: 2, retryDelayMs: 0 })
    ).rejects.toThrow(/LLM gateway/i);
    // bounded: 2 models × 2 attempts = 4 calls max
    expect(calls.length).toBeLessThanOrEqual(4);
  });

  it("does NOT fall back across tiers (never uses the money model)", async () => {
    const { fn, calls } = fakeFetch([empty(), empty(), empty(), empty(), empty(), empty()]);
    await expect(
      completeTierResilient("neuron", opts, { config: CFG, fetchImpl: fn, attemptsPerModel: 1, retryDelayMs: 0 })
    ).rejects.toThrow();
    for (const m of calls) {
      expect(TIER_MODEL_ALLOWLIST.neuron).toContain(m);
      expect(TIER_MODEL_ALLOWLIST.money).not.toContain(m);
    }
  });

  it("honours an explicit allowlisted model as the primary", async () => {
    const { fn, calls } = fakeFetch([ok("x")]);
    await completeTierResilient("neuron", { ...opts, model: "gpt-4o-mini" }, { config: CFG, fetchImpl: fn });
    expect(calls[0]).toBe("gpt-4o-mini");
  });
});
