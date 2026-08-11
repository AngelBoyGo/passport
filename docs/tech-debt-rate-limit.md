# Distributed Rate Limiting — Tech Debt

## Problem
The rate limiter in `src/lib/rateLimit.ts` uses an in-memory `Map<string, RateBucket>`.
In single-replica deployments (current Railway setup) this works correctly.
If scaled to multiple replicas, each instance has its own bucket — a client can
exhaust the limit on one instance and retry on another.

## Recommended solution

Add `@upstash/ratelimit` (or similar) as an optional dependency:

```bash
npm install @upstash/ratelimit @upstash/redis
```

Create a provider interface in `src/lib/rateLimit.ts`:

```typescript
interface RateLimitProvider {
  check(key: string, max: number, windowMs: number): Promise<{ allowed: boolean; retryAfterSec?: number }>;
}

class InMemoryRateLimit implements RateLimitProvider { /* existing logic */ }
class UpstashRateLimit implements RateLimitProvider { /* sliding window via Redis */ }
```

Swap based on `RATE_LIMIT_PROVIDER` env var ("memory" | "upstash"):

```typescript
const provider: RateLimitProvider =
  process.env.RATE_LIMIT_PROVIDER === "upstash"
    ? new UpstashRateLimit()
    : new InMemoryRateLimit();
```

The `UpstashRateLimit` class wraps `@upstash/ratelimit` sliding window:

```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

class UpstashRateLimit implements RateLimitProvider {
  private ratelimit: Ratelimit;

  constructor() {
    this.ratelimit = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(30, "1 m"),
      analytics: true,
    });
  }

  async check(key: string, max: number, windowMs: number) {
    // Recreate limiter with dynamic params
    const limiter = Ratelimit.slidingWindow(max, `${windowMs / 1000} s`);
    const result = await limiter.limit(key);
    return { allowed: result.success, retryAfterSec: result.reset };
  }
}
```

## Env vars
```
RATE_LIMIT_PROVIDER=memory       # default
# or for distributed:
# RATE_LIMIT_PROVIDER=upstash
# UPSTASH_REDIS_REST_URL=...
# UPSTASH_REDIS_REST_TOKEN=...
```

## Priority
Low — not blocking single-replica production deploy. Revisit when scaling to 2+ replicas.