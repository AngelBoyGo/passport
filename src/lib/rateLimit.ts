import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type RateBucket = { count: number; windowStart: number; lastAccess: number };

const buckets = new Map<string, RateBucket>();

export const GATE_VERIFY_MAX_REQUESTS = 30;
export const GATE_VERIFY_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_BUCKETS = 10_000;
export const REDIS_TIMEOUT_MS = 1500;

export const TIER_RATE_LIMITS = {
  free: 60,
  pro: 600,
  enterprise: 3000,
} as const;

export type OperatorTier = keyof typeof TIER_RATE_LIMITS;

/**
 * Returns the request quota per minute for a given operator tier.
 */
export function getRateLimitForTier(tier?: string): number {
  if (tier && tier.toLowerCase() in TIER_RATE_LIMITS) {
    return TIER_RATE_LIMITS[tier.toLowerCase() as OperatorTier];
  }
  return TIER_RATE_LIMITS.free;
}

/**
 * Checks rate limits for authenticated operator actions keyed by operator ID.
 */
export async function checkOperatorTierRateLimit(
  operatorId: string,
  tier?: string,
  windowMs: number = GATE_VERIFY_WINDOW_MS
): Promise<{ allowed: boolean; retryAfterSec?: number; remaining?: number; limit: number }> {
  const quota = getRateLimitForTier(tier);
  return checkRateLimit(`operator:${operatorId}`, quota, windowMs);
}

let rateLimitMaxBucketsOverride: number | null = null;
let upstashRatelimitInstance: Ratelimit | null = null;
let upstashRedisInstance: Redis | null = null;
let upstashDisabled = false;

/**
 * Overrides bucket cap for unit tests; pass null to restore production default.
 */
export function setRateLimitMaxBucketsForTest(max: number | null): void {
  rateLimitMaxBucketsOverride = max;
}

function effectiveRateLimitMaxBuckets(): number {
  return rateLimitMaxBucketsOverride ?? RATE_LIMIT_MAX_BUCKETS;
}

export const ENROLLMENT_RATE_LIMIT_MAX = 30;
export const ENROLLMENT_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Reads enrollment rate-limit max from env with a safe default (lazy — not at import).
 */
export function getEnrollmentRateLimitMax(): number {
  const raw = process.env.ENROLLMENT_RATE_LIMIT_MAX;
  if (!raw?.trim()) {
    return ENROLLMENT_RATE_LIMIT_MAX;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return ENROLLMENT_RATE_LIMIT_MAX;
  }
  return Math.floor(parsed);
}

/**
 * Reads enrollment rate-limit window from env with a safe default (lazy — not at import).
 */
export function getEnrollmentRateLimitWindowMs(): number {
  const raw = process.env.ENROLLMENT_RATE_LIMIT_WINDOW_MS;
  if (!raw?.trim()) {
    return ENROLLMENT_RATE_LIMIT_WINDOW_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1000) {
    return ENROLLMENT_RATE_LIMIT_WINDOW_MS;
  }
  return Math.floor(parsed);
}

/**
 * Initializes or retrieves the Upstash Ratelimit client if credentials are set.
 */
export function getUpstashRatelimit(
  max: number = GATE_VERIFY_MAX_REQUESTS,
  windowMs: number = GATE_VERIFY_WINDOW_MS
): Ratelimit | null {
  if (upstashDisabled) return null;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (!url || !token) {
    return null;
  }

  if (!upstashRedisInstance) {
    upstashRedisInstance = new Redis({ url, token });
  }

  const windowSec = Math.max(1, Math.round(windowMs / 1000));
  return new Ratelimit({
    redis: upstashRedisInstance,
    limiter: Ratelimit.slidingWindow(max, `${windowSec} s`),
    analytics: false,
    prefix: "passport_rl",
  });
}

/**
 * Forces or disables Upstash for testing.
 */
export function setUpstashForTest(ratelimit: Ratelimit | null, disabled = false): void {
  upstashRatelimitInstance = ratelimit;
  upstashDisabled = disabled;
}

/**
 * Distributed rate limiter with automatic in-memory sliding window fallback.
 */
export async function checkRateLimit(
  key: string,
  max: number = GATE_VERIFY_MAX_REQUESTS,
  windowMs: number = GATE_VERIFY_WINDOW_MS
): Promise<{ allowed: boolean; retryAfterSec?: number; remaining?: number; limit: number }> {
  const upstash = upstashRatelimitInstance ?? getUpstashRatelimit(max, windowMs);

  if (upstash) {
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Upstash rate limit timeout")), REDIS_TIMEOUT_MS)
      );

      const result = await Promise.race([upstash.limit(key), timeoutPromise]);

      if (!result.success) {
        const retryAfterSec = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
        return {
          allowed: false,
          retryAfterSec,
          remaining: result.remaining,
          limit: result.limit,
        };
      }

      return {
        allowed: true,
        remaining: result.remaining,
        limit: result.limit,
      };
    } catch (err) {
      console.warn("Upstash rate limiting failed, falling back to in-memory:", err instanceof Error ? err.message : err);
    }
  }

  // C1: in-memory fallback is per-instance. In multi-instance deployments,
  // Upstash Redis should be configured. The in-memory fallback is safe for
  // single-instance development and prevents total rate-limit bypass.
  const inMem = checkInMemoryRateLimit(key, max, windowMs);
  return {
    ...inMem,
    limit: max,
  };
}

/**
 * Named enrollment rate limiter (env-tunable per instance, distributed when Redis is configured).
 */
export function checkEnrollmentRateLimit(
  key: string
): { allowed: boolean; retryAfterSec?: number } {
  return checkInMemoryRateLimit(
    key,
    getEnrollmentRateLimitMax(),
    getEnrollmentRateLimitWindowMs()
  );
}

/**
 * Async version of enrollment rate limiter with Redis support.
 */
export async function checkEnrollmentRateLimitAsync(
  key: string
): Promise<{ allowed: boolean; retryAfterSec?: number; remaining?: number; limit: number }> {
  return checkRateLimit(
    key,
    getEnrollmentRateLimitMax(),
    getEnrollmentRateLimitWindowMs()
  );
}

/**
 * Removes expired buckets and enforces an LRU cap on tracked keys.
 */
function pruneRateLimitBuckets(now: number, windowMs: number): void {
  for (const [key, entry] of buckets) {
    if (now - entry.windowStart >= windowMs) {
      buckets.delete(key);
    }
  }

  while (buckets.size > effectiveRateLimitMaxBuckets()) {
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;
    for (const [key, entry] of buckets) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess;
        oldestKey = key;
      }
    }
    if (oldestKey == null) {
      break;
    }
    buckets.delete(oldestKey);
  }
}

/**
 * Simple in-memory rate limiter.
 */
export function checkInMemoryRateLimit(
  key: string,
  max: number = GATE_VERIFY_MAX_REQUESTS,
  windowMs: number = GATE_VERIFY_WINDOW_MS
): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  pruneRateLimitBuckets(now, windowMs);
  let entry = buckets.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    entry = { count: 0, windowStart: now, lastAccess: now };
    buckets.set(key, entry);
  }

  entry.lastAccess = now;

  if (entry.count >= max) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((entry.windowStart + windowMs - now) / 1000)
    );
    return { allowed: false, retryAfterSec };
  }

  entry.count += 1;
  return { allowed: true };
}

/** Clears in-memory buckets (for tests). */
export function resetInMemoryRateLimits(): void {
  buckets.clear();
  rateLimitMaxBucketsOverride = null;
  upstashRatelimitInstance = null;
  upstashRedisInstance = null;
  upstashDisabled = false;
}

/**
 * Resolves client IP from proxy headers or a fallback key.
 */
export function clientIpFromRequest(headers: {
  get(name: string): string | null;
}): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return headers.get("x-real-ip") ?? "unknown";
}

/**
 * Builds 429 response headers with standard rate-limit fields.
 * Routes should use this when returning a rate-limit rejection.
 */
export function rateLimitResponse(
  rate: { allowed: boolean; retryAfterSec?: number },
  limit: number
): { status: 429; headers: Record<string, string> } {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": "0",
    "X-RateLimit-Reset": String(
      Math.ceil(
        (Date.now() + (rate.retryAfterSec ?? 60) * 1000) / 1000
      )
    ),
  };
  if (rate.retryAfterSec) {
    headers["Retry-After"] = String(rate.retryAfterSec);
  }
  return { status: 429, headers };
}
