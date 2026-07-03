import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const logPassportEventMock = vi.fn();

vi.mock("@/lib/observability/logger", () => ({
  logPassportEvent: (...args: unknown[]) => logPassportEventMock(...args),
}));

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeEach(() => {
  vi.resetModules();
  logPassportEventMock.mockReset();
});

describe("withRouteObservability", () => {
  it("generates request_id and logs one completion line on success", async () => {
    const { withRouteObservability } = await import(
      "@/lib/observability/route-wrapper"
    );
    const handler = vi.fn(async () =>
      NextResponse.json({ ok: true }, { status: 200 })
    );
    const wrapped = withRouteObservability(handler, "gate_verify");

    const request = new NextRequest("http://localhost/api/v1/gate/verify", {
      method: "POST",
    });
    const response = await wrapped(request);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(logPassportEventMock).toHaveBeenCalledTimes(1);
    expect(logPassportEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "gate_verify",
        outcome: "issued",
        http_status: 200,
        request_id: expect.stringMatching(UUID_RE),
        latency_ms: expect.any(Number),
      })
    );
  });

  it("logs rejected outcome for 4xx responses without throwing", async () => {
    const { withRouteObservability } = await import(
      "@/lib/observability/route-wrapper"
    );
    const handler = vi.fn(async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
    const wrapped = withRouteObservability(handler, "receipt_issue");

    const response = await wrapped(
      new NextRequest("http://localhost/api/v1/receipts", { method: "POST" })
    );

    expect(response.status).toBe(401);
    expect(logPassportEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "receipt_issue",
        outcome: "rejected",
        http_status: 401,
        request_id: expect.stringMatching(UUID_RE),
      })
    );
  });

  it("catches unhandled errors, returns 500 once, logs unhandled_error", async () => {
    const { withRouteObservability } = await import(
      "@/lib/observability/route-wrapper"
    );
    const handler = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    const wrapped = withRouteObservability(handler, "gate_verify");

    const response = await wrapped(
      new NextRequest("http://localhost/api/v1/gate/verify", { method: "POST" })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Internal server error" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(logPassportEventMock).toHaveBeenCalledTimes(1);
    expect(logPassportEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "unhandled_error",
        outcome: "error",
        http_status: 500,
        request_id: expect.stringMatching(UUID_RE),
        latency_ms: expect.any(Number),
      })
    );
  });

  it("forwards route context args to the handler", async () => {
    const { withRouteObservability } = await import(
      "@/lib/observability/route-wrapper"
    );
    const handler = vi.fn(
      async (
        _request: NextRequest,
        context: { params: Promise<{ id: string }> }
      ) => {
        const { id } = await context.params;
        return NextResponse.json({ id }, { status: 200 });
      }
    );
    const wrapped = withRouteObservability(handler, "credits_read");
    const context = { params: Promise.resolve({ id: "a".repeat(64) }) };

    const response = await wrapped(
      new NextRequest("http://localhost/api/v1/passport/agents/x/credits"),
      context
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(expect.any(NextRequest), context);
    expect(logPassportEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "credits_read",
        http_status: 200,
        request_id: expect.stringMatching(UUID_RE),
      })
    );
  });

  it("never logs request bodies or authorization headers", async () => {
    const { withRouteObservability } = await import(
      "@/lib/observability/route-wrapper"
    );
    const handler = vi.fn(async () => NextResponse.json({}, { status: 201 }));
    const wrapped = withRouteObservability(handler, "receipt_issue");

    await wrapped(
      new NextRequest("http://localhost/api/v1/receipts", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-api-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agent_id: "agent-1",
          email: "user@stripe.com",
        }),
      })
    );

    const logged = JSON.stringify(logPassportEventMock.mock.calls[0][0]);
    expect(logged).not.toContain("secret-api-key");
    expect(logged).not.toContain("user@stripe.com");
    expect(logged).not.toContain("agent-1");
  });
});
