import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry, PassportHttpError } from "../http.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("fetchWithRetry", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries on 503 then succeeds on 200", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    globalThis.fetch = fetchMock;

    const promise = fetchWithRetry("https://api.example.com/test");

    await vi.advanceTimersByTimeAsync(200);
    const response = await promise;

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 400", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad request", { status: 400 }));

    globalThis.fetch = fetchMock;

    const response = await fetchWithRetry("https://api.example.com/test");

    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts after 4000ms timeout", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });

    globalThis.fetch = fetchMock;

    const promise = fetchWithRetry("https://api.example.com/slow", undefined, {
      timeoutMs: 4000,
      maxAttempts: 1,
    });

    const expectation = expect(promise).rejects.toBeInstanceOf(PassportHttpError);

    await vi.advanceTimersByTimeAsync(4000);
    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries network errors with exponential backoff then throws", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("network failure"));

    globalThis.fetch = fetchMock;

    const promise = fetchWithRetry("https://api.example.com/flaky");

    const expectation = expect(promise).rejects.toBeInstanceOf(PassportHttpError);

    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(800);
    await expectation;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
