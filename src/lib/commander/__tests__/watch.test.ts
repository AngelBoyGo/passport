import { describe, it, expect, afterEach, vi } from "vitest";
import { watchAll, renderFleetWatch, probeCallora, probeMarketplace } from "../watch";

const ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ENV };
  vi.restoreAllMocks();
});

function mockFetch(map: Record<string, { ok: boolean; status: number; body?: unknown }>) {
  global.fetch = vi.fn(async (url: string) => {
    for (const [key, val] of Object.entries(map)) {
      if (url.includes(key)) {
        return { ok: val.ok, status: val.status, json: async () => val.body ?? {} } as Response;
      }
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
}

describe("probeCallora", () => {
  it("reports up when health 200", async () => {
    process.env.CALLORA_BASE_URL = "https://call.test";
    mockFetch({ "/api/health": { ok: true, status: 200, body: { status: "ok" } } });
    const r = await probeCallora();
    expect(r.status).toBe("up");
    expect(r.name).toBe("callora");
  });

  it("reports down when health fails", async () => {
    process.env.CALLORA_BASE_URL = "https://call.test";
    mockFetch({ "/api/health": { ok: false, status: 503 } });
    const r = await probeCallora();
    expect(r.status).toBe("down");
    expect(r.error).toContain("503");
  });
});

describe("probeMarketplace", () => {
  it("is unconfigured when no base URL is set", async () => {
    delete process.env.MARKETPLACE_BASE_URL;
    const r = await probeMarketplace();
    expect(r.status).toBe("unconfigured");
    expect(r.error).toContain("MARKETPLACE_BASE_URL");
  });

  it("reports up (with queues) when configured and healthy", async () => {
    process.env.MARKETPLACE_BASE_URL = "https://market.test";
    mockFetch({
      "/api/health": { ok: true, status: 200, body: { status: "ok" } },
      "/api/routing/queues": { ok: true, status: 200, body: { counts: { "agent-only": 3 } } },
    });
    const r = await probeMarketplace();
    expect(r.status).toBe("up");
    expect((r.detail as { queues?: unknown }).queues).toBeTruthy();
  });

  it("falls back to /api/livez (Metis has no /api/health)", async () => {
    process.env.MARKETPLACE_BASE_URL = "https://market.test";
    // Only livez is healthy; /api/health would 404 as it does on Metis.
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes("/api/livez")) return { ok: true, status: 200, json: async () => ({ status: "ok" }) } as Response;
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
    const r = await probeMarketplace();
    expect(r.status).toBe("up");
    expect((r.detail as { health?: { path?: string } }).health?.path).toBe("/api/livez");
  });
});

describe("watchAll + renderFleetWatch", () => {
  it("never throws and always lists all four subsystems", async () => {
    delete process.env.MARKETPLACE_BASE_URL;
    process.env.CALLORA_BASE_URL = "https://call.test";
    mockFetch({ "/api/health": { ok: true, status: 200 } });
    const snap = await watchAll();
    expect(snap.subsystems.map((s) => s.name).sort()).toEqual(
      ["callora", "marketplace", "medora", "passport"]
    );
    const text = renderFleetWatch(snap);
    expect(text).toContain("Fleet watch");
    expect(text).toContain("marketplace");
  });
});
