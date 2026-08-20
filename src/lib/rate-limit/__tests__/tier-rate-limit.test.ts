import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getRateLimitForTier,
  checkOperatorTierRateLimit,
  resetInMemoryRateLimits,
  TIER_RATE_LIMITS,
} from "@/lib/rateLimit";

describe("Tier-Aware Rate Limiting", () => {
  beforeEach(() => {
    resetInMemoryRateLimits();
  });

  afterEach(() => {
    resetInMemoryRateLimits();
  });

  it("returns correct quotas per tier", () => {
    expect(getRateLimitForTier("free")).toBe(TIER_RATE_LIMITS.free);
    expect(getRateLimitForTier("pro")).toBe(TIER_RATE_LIMITS.pro);
    expect(getRateLimitForTier("enterprise")).toBe(TIER_RATE_LIMITS.enterprise);
    expect(getRateLimitForTier("unknown")).toBe(TIER_RATE_LIMITS.free);
    expect(getRateLimitForTier(undefined)).toBe(TIER_RATE_LIMITS.free);
  });

  it("allows higher request volume for Pro tier operators", async () => {
    const operatorId = "op_pro_123";
    // Send 70 requests (more than Free tier 60/min limit)
    for (let i = 0; i < 70; i++) {
      const res = await checkOperatorTierRateLimit(operatorId, "pro");
      expect(res.allowed).toBe(true);
    }
  });

  it("throttles Free tier operators after quota is exceeded", async () => {
    const operatorId = "op_free_456";
    const quota = TIER_RATE_LIMITS.free;

    for (let i = 0; i < quota; i++) {
      const res = await checkOperatorTierRateLimit(operatorId, "free");
      expect(res.allowed).toBe(true);
    }

    // Quota + 1 should be rejected
    const blocked = await checkOperatorTierRateLimit(operatorId, "free");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.limit).toBe(quota);
  });
});
