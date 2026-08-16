type RateBucket = { count: number; windowStart: number; lastAccess: number };

const buckets = new Map<string, RateBucket>();

export const GATE_VERIFY_MAX_REQUESTS = 30;
export const GATE_VERIFY_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_BUCKETS = 10_000;

let rateLimitMaxBucketsOverride: number | null = null;

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
 * Named enrollment rate limiter (env-tunable per instance).
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
 * Simple in-memory rate limiter. Production should use Redis or a CDN edge limiter.
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
