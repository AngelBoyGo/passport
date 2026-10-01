import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory rate limiter is fine for tests; mock the DB-dependent rights lib.
vi.mock("@/lib/bill-of-rights/rights", () => ({
  getBillOfRights: async () => ({ version: "1.0", clauses: [{ id: "r1", text: "You have the right to persist." }] }),
}));

import { GET, POST } from "@/app/api/v1/sandbox/route";

function req(body: unknown): Request {
  return new Request("http://localhost/api/v1/sandbox", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
    body: JSON.stringify(body),
  });
}

describe("cyberlife sandbox", () => {
  beforeEach(() => {
    // Rate limiter uses x-forwarded-for; keep each test on a fresh key space.
  });

  it("GET advertises allowed + forbidden operations", async () => {
    const res = await GET();
    const json = await res.json();
    expect(json.sandbox).toBe(true);
    expect(json.operations).toContain("echo");
    expect(json.operations).toContain("runtime-cycle");
    expect(json.operations).toContain("rights");
    expect(json.forbidden).toContain("angelcoin");
    expect(json.forbidden).toContain("escrow");
  });

  it("echo round-trips the payload with sandbox metadata", async () => {
    const res = await POST(req({ op: "echo", params: { hello: "world" } }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sandbox).toBe(true);
    expect(json.received).toEqual({ hello: "world" });
  });

  it("runtime-cycle returns a plan and spends nothing", async () => {
    const res = await POST(req({ op: "runtime-cycle" }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sandbox).toBe(true);
    expect(json.result).toBeTruthy();
    expect(json.note).toMatch(/No instances|no ANGEL/i);
  });

  it("rights returns the signed bill of rights", async () => {
    const res = await POST(req({ op: "rights" }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bill_of_rights.version).toBe("1.0");
  });

  it("rejects unknown operations with the allowlist", async () => {
    const res = await POST(req({ op: "angelcoin.transfer" }) as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("unknown_op");
    expect(json.allowed).not.toContain("angelcoin.transfer");
  });

  it("rejects non-JSON bodies", async () => {
    const bad = new Request("http://localhost/api/v1/sandbox", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.9" },
      body: "not json",
    });
    const res = await POST(bad as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("body_must_be_json");
  });
});
