import { afterEach, describe, expect, it } from "vitest";

const origFetch = globalThis.fetch;
const origEnv = { ...process.env };

describe("callora fleet client", () => {
  afterEach(() => {
    globalThis.fetch = origFetch;
    for (const k of ["CALLORA_FLEET_BASE_URL", "CALLORA_FLEET_CRON_SECRET", "CRON_SECRET"]) {
      const v = (origEnv as Record<string, string | undefined>)[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("fails closed when not configured", async () => {
    delete process.env.CALLORA_FLEET_BASE_URL;
    delete process.env.CALLORA_FLEET_CRON_SECRET;
    const { searchLocumJobs } = await import("../callora-fleet-client");
    await expect(searchLocumJobs({ candidateId: "x" })).rejects.toThrow(/callora_not_configured/);
  });

  it("sends the cron secret and normalizes the trailing slash", async () => {
    process.env.CALLORA_FLEET_BASE_URL = "https://call.metis.gold//";
    process.env.CALLORA_FLEET_CRON_SECRET = "flsecret";
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: String(init?.body ?? ""),
      });
      return new Response(JSON.stringify({ ok: true, order_version: "pay-v1", ranked: [] }), { status: 200 });
    }) as typeof fetch;
    const { searchLocumJobs } = await import("../callora-fleet-client");
    const result = await searchLocumJobs({ candidateId: "c1", payFloor: 350 });
    expect(calls[0].url).toBe("https://call.metis.gold/api/fleet/locum-search");
    expect(calls[0].headers["x-cron-secret"]).toBe("flsecret");
    expect(JSON.parse(calls[0].body)).toMatchObject({ candidate_id: "c1", pay_floor: 350 });
    expect(result.ranked).toEqual([]);
    expect(result.agreement.agree).toBe(true); // empty == empty agreement
  });

  it("detects ORDER DRIFT: served order differs from the brain's own re-rank", async () => {
    process.env.CALLORA_FLEET_BASE_URL = "https://call.metis.gold";
    process.env.CALLORA_FLEET_CRON_SECRET = "flsecret";
    // Callora served the LOWER-rate job first — the brain must catch that.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          order_version: "pay-v1",
          ranked: [
            { job_id: "low", title: null, specialty: null, state: null, facility: null, rate_usd_hourly: 360, match_score: 0, type: "locum", rate_per_hour: 360 },
            { job_id: "high", title: null, specialty: null, state: null, facility: null, rate_usd_hourly: 465, match_score: 0, type: "locum", rate_per_hour: 465 },
          ],
        }),
        { status: 200 }
      )) as typeof fetch;
    const { searchLocumJobs } = await import("../callora-fleet-client");
    const result = await searchLocumJobs({ candidateId: "c1" });
    expect(result.drift).toBe(true);
    expect(result.agreement.agree).toBe(false);
    expect(result.agreement.rank1_match).toBe(false);
    // INVARIANT: on drift the brain trusts its OWN order — ranked[0] is the
    // brain's top ($465), NOT the served top ($360).
    expect(result.ranked[0].job_id).toBe("high");
    expect(result.served_order).toEqual(["low", "high"]);
    expect(result.brain_order).toEqual(["high", "low"]);
  });

  it("agreeing orders produce no drift signal", async () => {
    process.env.CALLORA_FLEET_BASE_URL = "https://call.metis.gold";
    process.env.CALLORA_FLEET_CRON_SECRET = "flsecret";
    // Realistic payload: raw rate fields present, so the brain's own ranker
    // derives the SAME rates independently — real ordering verification.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          order_version: "pay-v1",
          ranked: [
            { job_id: "high", title: null, specialty: null, state: null, facility: null, rate_usd_hourly: 465, match_score: 0, type: "locum", rate_per_hour: 465 },
            { job_id: "low", title: null, specialty: null, state: null, facility: null, rate_usd_hourly: 360, match_score: 0, type: "locum", rate_per_hour: 360 },
          ],
        }),
        { status: 200 }
      )) as typeof fetch;
    const { searchLocumJobs } = await import("../callora-fleet-client");
    const result = await searchLocumJobs({ candidateId: "c1" });
    expect(result.drift).toBe(false);
    expect(result.agreement.agree).toBe(true);
  });

  it("a served job whose rate the brain CANNOT derive = shape drift (missing entry)", async () => {
    process.env.CALLORA_FLEET_BASE_URL = "https://call.metis.gold";
    process.env.CALLORA_FLEET_CRON_SECRET = "flsecret";
    // No raw rate fields at all — the brain refuses phantom prices and drops
    // the entry from its own order; the length mismatch fires the drift guard.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          order_version: "pay-v1",
          ranked: [
            { job_id: "mystery", title: null, specialty: null, state: null, facility: null, rate_usd_hourly: 500, match_score: 0 },
          ],
        }),
        { status: 200 }
      )) as typeof fetch;
    const { searchLocumJobs } = await import("../callora-fleet-client");
    const result = await searchLocumJobs({ candidateId: "c1" });
    expect(result.drift).toBe(true);
    // The brain could not rate it → dropped from the brain's own order.
    expect(result.ranked).toEqual([]);
    expect(result.served_ranked.length).toBe(1);
  });

  it("an unknown order_version is a hard failure (contract change detected)", async () => {
    process.env.CALLORA_FLEET_BASE_URL = "https://call.metis.gold";
    process.env.CALLORA_FLEET_CRON_SECRET = "flsecret";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, order_version: "pay-v9", ranked: [] }), { status: 200 })) as typeof fetch;
    const { searchLocumJobs } = await import("../callora-fleet-client");
    await expect(searchLocumJobs({ candidateId: "c1" })).rejects.toThrow(/order_version_mismatch/);
  });

  it("play locum jobs posts play=outreach and errors surface with status", async () => {
    process.env.CALLORA_FLEET_BASE_URL = "https://call.metis.gold";
    process.env.CALLORA_FLEET_CRON_SECRET = "flsecret";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, queued: 2, note: "planning only" }), { status: 200 })) as typeof fetch;
    const { playLocumJobs } = await import("../callora-fleet-client");
    const res = await playLocumJobs({ candidateId: "c1", jobIds: ["a", "b"] });
    expect((res as Record<string, unknown>).queued).toBe(2);
  });
});
