import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkRateLimit,
  resetInMemoryRateLimits,
  setUpstashForTest,
  rateLimitResponse,
  checkInMemoryRateLimit,
} from "@/lib/rateLimit";

describe("Distributed Rate Limiting & Upstash Fallback", () => {
  beforeEach(() => {
    resetInMemoryRateLimits();
    vi.clearAllMocks();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  afterEach(() => {
    resetInMemoryRateLimits();
  });

  it("uses in-memory rate limiting when Redis env vars are absent", async () => {
    const key = "test-ip-1";
    // 3 requests allowed with max=3
    const res1 = await checkRateLimit(key, 3, 60_000);
    const res2 = await checkRateLimit(key, 3, 60_000);
    const res3 = await checkRateLimit(key, 3, 60_000);
    const res4 = await checkRateLimit(key, 3, 60_000);

    expect(res1.allowed).toBe(true);
    expect(res2.allowed).toBe(true);
    expect(res3.allowed).toBe(true);
    expect(res4.allowed).toBe(false);
    expect(res4.retryAfterSec).toBeGreaterThan(0);
    expect(res4.limit).toBe(3);
  });

  it("calls Upstash Ratelimit when configured and success is returned", async () => {
    const mockLimit = vi.fn().mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60_000,
    });

    setUpstashForTest({ limit: mockLimit } as any);

    const res = await checkRateLimit("client-ip", 10, 60_000);
    expect(mockLimit).toHaveBeenCalledWith("client-ip");
    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(9);
    expect(res.limit).toBe(10);
  });

  it("returns 429 details when Upstash limits the request", async () => {
    const mockLimit = vi.fn().mockResolvedValue({
      success: false,
      limit: 5,
      remaining: 0,
      reset: Date.now() + 45_000,
    });

    setUpstashForTest({ limit: mockLimit } as any);

    const res = await checkRateLimit("client-ip-over-limit", 5, 60_000);
    expect(res.allowed).toBe(false);
    expect(res.retryAfterSec).toBe(45);
    expect(res.remaining).toBe(0);
  });

  it("seamlessly falls back to in-memory without throwing when Upstash throws", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockLimit = vi.fn().mockRejectedValue(new Error("Redis connection refused"));

    setUpstashForTest({ limit: mockLimit } as any);

    // Should fall back to in-memory and allow first request
    const res1 = await checkRateLimit("client-ip-fallback", 2, 60_000);
    expect(res1.allowed).toBe(true);
    expect(warnSpy).toHaveBeenCalled();

    // 2nd request in memory
    const res2 = await checkRateLimit("client-ip-fallback", 2, 60_000);
    expect(res2.allowed).toBe(true);

    // 3rd request rejected in memory
    const res3 = await checkRateLimit("client-ip-fallback", 2, 60_000);
    expect(res3.allowed).toBe(false);
  });

  it("rateLimitResponse builds RFC compliant headers with Retry-After and X-RateLimit-*", () => {
    const { status, headers } = rateLimitResponse({ allowed: false, retryAfterSec: 30 }, 100);
    expect(status).toBe(429);
    expect(headers["X-RateLimit-Limit"]).toBe("100");
    expect(headers["X-RateLimit-Remaining"]).toBe("0");
    expect(headers["Retry-After"]).toBe("30");
    expect(Number(headers["X-RateLimit-Reset"])).toBeGreaterThan(0);
  });
});
