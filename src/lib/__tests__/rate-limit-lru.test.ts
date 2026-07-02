import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkInMemoryRateLimit,
  resetInMemoryRateLimits,
  setRateLimitMaxBucketsForTest,
} from "@/lib/rateLimit";

beforeEach(() => {
  resetInMemoryRateLimits();
});

afterEach(() => {
  vi.useRealTimers();
  resetInMemoryRateLimits();
});

describe("checkInMemoryRateLimit bucket maintenance", () => {
  it("resets an expired bucket so the key gets a fresh quota", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    for (let i = 0; i < 3; i++) {
      expect(checkInMemoryRateLimit("client-a", 3, 1_000).allowed).toBe(true);
    }
    expect(checkInMemoryRateLimit("client-a", 3, 1_000).allowed).toBe(false);

    vi.setSystemTime(now + 1_001);

    for (let i = 0; i < 3; i++) {
      expect(checkInMemoryRateLimit("client-a", 3, 1_000).allowed).toBe(true);
    }
  });

  it("evicts the least-recently-used bucket when the cap is exceeded", () => {
    vi.useFakeTimers();
    const start = Date.now();
    vi.setSystemTime(start);
    setRateLimitMaxBucketsForTest(2);

    expect(checkInMemoryRateLimit("first", 1, 60_000).allowed).toBe(true);
    vi.setSystemTime(start + 1);
    expect(checkInMemoryRateLimit("second", 1, 60_000).allowed).toBe(true);
    vi.setSystemTime(start + 2);
    expect(checkInMemoryRateLimit("first", 1, 60_000).allowed).toBe(false);
    vi.setSystemTime(start + 3);
    expect(checkInMemoryRateLimit("third", 1, 60_000).allowed).toBe(true);
    vi.setSystemTime(start + 4);
    expect(checkInMemoryRateLimit("second", 1, 60_000).allowed).toBe(true);
    vi.setSystemTime(start + 5);
    expect(checkInMemoryRateLimit("first", 1, 60_000).allowed).toBe(true);
  });
});
