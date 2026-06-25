type RateBucket = { count: number; windowStart: number };

const buckets = new Map<string, RateBucket>();

export const GATE_VERIFY_MAX_REQUESTS = 30;
export const GATE_VERIFY_WINDOW_MS = 60_000;

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
 * Simple in-memory rate limiter. Production should use Redis or a CDN edge limiter.
 */
export function checkInMemoryRateLimit(
  key: string,
  max: number = GATE_VERIFY_MAX_REQUESTS,
  windowMs: number = GATE_VERIFY_WINDOW_MS
): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  let entry = buckets.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    entry = { count: 0, windowStart: now };
    buckets.set(key, entry);
  }

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
