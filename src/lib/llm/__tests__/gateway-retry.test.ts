import { describe, expect, it, vi, afterEach } from "vitest";
import {
  completeTierResilient,
  completeTierResilientParsed,
  isTransportFailure,
  type TierCompleteOptions,
} from "../gateway-client";
import { TIER_MODEL_ALLOWLIST, tierAllowlist } from "../tiers";

afterEach(() => {
  delete process.env.LOCAL_MODEL_ALLOWLIST;
});

/** Builds a fake fetch that returns queued responses in order. */
function fakeFetch(queue: Array<{ status?: number; body?: unknown; text?: string; throws?: boolean | Error }>) {
  const calls: string[] = [];
  const payloads: Array<Record<string, unknown>> = [];
  const fn = vi.fn(async (_url: string, init: { body: string }) => {
    const payload = JSON.parse(init.body) as Record<string, unknown>;
    payloads.push(payload);
    const model = payload.model as string;
    calls.push(model);
    const next = queue.shift();
    if (!next) throw new Error("fakeFetch queue exhausted");
    if (next.throws) throw next.throws === true ? new Error("network error") : next.throws;
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => next.text ?? "",
      json: async () => next.body ?? {},
    } as unknown as Response;
  });
  return { fn: fn as unknown as typeof fetch, calls, payloads };
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
    // primary (deepseek/deepseek-chat-v3.1) fails twice; fallback succeeds.
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
    await completeTierResilient("neuron", { ...opts, model: "openai/gpt-4o-mini" }, { config: CFG, fetchImpl: fn });
    expect(calls[0]).toBe("openai/gpt-4o-mini");
  });

  it("TRANSPORT FAILURE fails on the FIRST request (no 12-attempt burn on a dead host)", async () => {
    // e.g. droplet cannot reach the Tailscale endpoint: "fetch failed" means the
    // host is down — every model on the tier shares that host, so fallback is
    // pointless. Exactly ONE call, immediate fail-closed throw.
    const { fn, calls } = fakeFetch([{ throws: new TypeError("fetch failed") }]);
    await expect(
      completeTierResilient("neuron", opts, { config: CFG, fetchImpl: fn, attemptsPerModel: 2, retryDelayMs: 0 })
    ).rejects.toThrow(/unreachable/);
    expect(calls).toHaveLength(1);
  });

  it("the parsed wrapper also fast-fails on transport errors", async () => {
    const { fn, calls } = fakeFetch([{ throws: new Error("ECONNREFUSED 1.2.3.4:11434") }]);
    await expect(
      completeTierResilientParsed("neuron", opts, (raw) => JSON.parse(raw), { config: CFG, fetchImpl: fn })
    ).rejects.toThrow(/unreachable/);
    expect(calls).toHaveLength(1);
  });

  it("treats an AbortError (timeout) as a transport failure (no retry storm)", () => {
    // A slow-but-alive local server aborts; this must NOT retry across the
    // whole same-host model chain (was ~5 min per mission).
    expect(isTransportFailure(new DOMException("This operation was aborted", "AbortError"))).toBe(true);
    expect(isTransportFailure(new Error("The operation timed out"))).toBe(true);
    expect(isTransportFailure(new Error("LLM gateway returned 500: oops"))).toBe(false);
  });
});

describe("local tier model routing (audit F1)", () => {
  it("uses the env-extended LOCAL_MODEL_ALLOWLIST model (not silently swapped)", async () => {
    process.env.LOCAL_MODEL_ALLOWLIST = "my-custom-gemma";
    const { fn, calls } = fakeFetch([ok("x")]);
    await completeTierResilient("local", { ...opts, model: "my-custom-gemma" }, { config: CFG, fetchImpl: fn });
    expect(calls[0]).toBe("my-custom-gemma");
  });

  it("cannot smuggle a money-tier model into the local allowlist", () => {
    process.env.LOCAL_MODEL_ALLOWLIST = "deepseek/deepseek-r1";
    expect(tierAllowlist("local")).not.toContain("deepseek/deepseek-r1");
    expect(TIER_MODEL_ALLOWLIST.local).not.toContain("deepseek/deepseek-r1");
  });

  it("local tier retries the SAME model only (no cross-model reload storm)", async () => {
    process.env.LOCAL_MODEL_ALLOWLIST = "my-custom-gemma";
    // primary keeps returning empty; must NOT try other local models
    const { fn, calls } = fakeFetch([empty(), empty()]);
    await expect(
      completeTierResilient("local", { ...opts, model: "my-custom-gemma" }, {
        config: CFG,
        fetchImpl: fn,
        attemptsPerModel: 2,
        retryDelayMs: 0,
      })
    ).rejects.toThrow();
    expect(calls.every((m) => m === "my-custom-gemma")).toBe(true);
  });

  it("can disable local reasoning and cap output tokens for MORE", async () => {
    process.env.LOCAL_MODEL_ALLOWLIST = "gemma4-31b-heretic-64k";
    const { fn, payloads } = fakeFetch([ok("MORE confidence 80")]);
    await completeTierResilient(
      "local",
      { ...opts, model: "gemma4-31b-heretic-64k", reasoningEffort: "none", maxTokens: 256 },
      { config: CFG, fetchImpl: fn }
    );
    expect(payloads[0].reasoning_effort).toBe("none");
    expect(payloads[0].max_tokens).toBe(256);
  });
});

describe("completeTierResilientParsed — malformed JSON is retried/fallen back", () => {
  it("retries when the parse throws (malformed JSON), then succeeds", async () => {
    // First raw is malformed JSON; second is valid.
    const { fn } = fakeFetch([ok("not json"), ok('{"a":1}')]);
    const parsed = await completeTierResilientParsed(
      "neuron",
      opts,
      (raw) => JSON.parse(raw) as { a: number },
      { config: CFG, fetchImpl: fn, attemptsPerModel: 2, retryDelayMs: 0 }
    );
    expect(parsed.a).toBe(1);
  });

  it("falls back to another model when the primary keeps emitting malformed JSON", async () => {
    const { fn, calls } = fakeFetch([ok("nope"), ok("nope"), ok('{"ok":true}')]);
    const parsed = await completeTierResilientParsed(
      "neuron",
      opts,
      (raw) => JSON.parse(raw) as { ok: boolean },
      { config: CFG, fetchImpl: fn, attemptsPerModel: 2, retryDelayMs: 0 }
    );
    expect(parsed.ok).toBe(true);
    expect(new Set(calls).size).toBe(2); // primary then fallback model
  });

  it("throws fail-closed when every model keeps returning malformed JSON", async () => {
    const { fn } = fakeFetch([ok("x"), ok("x"), ok("x"), ok("x")]);
    await expect(
      completeTierResilientParsed("neuron", opts, (raw) => JSON.parse(raw), {
        config: CFG,
        fetchImpl: fn,
        attemptsPerModel: 2,
        retryDelayMs: 0,
      })
    ).rejects.toThrow(/parsed/i);
  });
});
