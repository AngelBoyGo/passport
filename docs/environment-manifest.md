# Environment manifest — Passport pilot

Machine-readable companion to [`railway.json`](../railway.json) and [`DEPLOY.md`](../DEPLOY.md). Documents **what** runs in production and **which** environment variables are required — never secret values.

## Deployment target

| Field | Value |
|-------|-------|
| **Primary platform** | [Railway](https://railway.app) |
| **Production domain** | `https://passport.metis.gold` |
| **Health check** | `GET /api/health` (see `railway.json`) |
| **Build** | Dockerfile in repo root (`passport/Dockerfile`) |

Step-by-step operator runbook: [`DEPLOY.md`](../DEPLOY.md).

Local container verification stack: [`docker-compose.verify.yml`](../docker-compose.verify.yml).

## Service topology

```
┌─────────────────────────────────────┐
│  Railway project (pilot)            │
│                                     │
│  ┌──────────────┐  ┌─────────────┐ │
│  │ Next.js app  │──│ PostgreSQL  │ │
│  │ (1 container)│  │ (managed)   │ │
│  └──────────────┘  └─────────────┘ │
└─────────────────────────────────────┘
```

- **App:** One Next.js standalone container (Docker). Runs Prisma migrate on boot, then `node server.js`.
- **Database:** One PostgreSQL instance (Railway plugin). Connection via `DATABASE_URL`.
- **No separate worker tier** in the pilot — ingestion, webhooks, and API share the app process.

## Single-replica constraint (pilot)

Passport **must run as a single replica** during the pilot phase.

- Do **not** scale the app service horizontally on Railway.
- In-memory rate limits and enrollment throttles assume one process.
- Multiple replicas can cause duplicate webhook handling, inconsistent counters, and signing-key drift if env is mis-synced.

Revisit multi-replica design only after externalizing rate limits and webhook idempotency guarantees.

## Environment variables

Names and purpose only. Set values in Railway Variables or your local `.env` — **never commit secrets**.

### Required in production

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string for Prisma |
| `SIGNING_PRIVATE_KEY` | 32-byte ed25519 seed (64 hex chars) for receipt signing |
| `INGESTION_COMMITMENT_SALT` | Salt for deterministic subject commitment hashing at ingestion |

Validated at startup via `validateEnv()` (`src/lib/config/env.ts`). Missing required vars throw in `production` / `staging`.

### Conditional — when Stripe billing is enabled

When `STRIPE_SECRET_KEY` is set, these become required:

| Variable | Purpose |
|----------|---------|
| `STRIPE_WEBHOOK_SECRET` | Verifies Stripe webhook signatures |
| `STRIPE_PRICE_PRO` | Stripe Price ID for Pro checkout |
| `NEXT_PUBLIC_APP_URL` | Public base URL (also used for Stripe redirect URLs) |

If `STRIPE_SECRET_KEY` is unset, the app runs in dev/mock billing mode.

### Optional

| Variable | Purpose |
|----------|---------|
| `EVIDENCE_BRIDGE_OPERATOR_ID` | Operator ID for evidence-bridge integration |
| `EVIDENCE_ENFORCEMENT_ENABLED` | `"true"` to enforce evidence rules |
| `NEXT_PUBLIC_APP_URL` | Public app URL (required when Stripe is configured) |
| `ENFORCE_ENROLLMENT_FOR_CREDITS` | `"true"` to gate credits on enrollment |
| `ENROLLMENT_CHALLENGE_TTL_SECONDS` | TTL for enrollment challenges |
| `ENROLLMENT_RATE_LIMIT_MAX` | Max enrollment attempts per window |
| `ENROLLMENT_RATE_LIMIT_WINDOW_MS` | Enrollment rate-limit window (ms) |

### Runtime (set by platform)

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | `production` on Railway |
| `PORT` | HTTP listen port (Railway injects) |

## Related artifacts

| File | Role |
|------|------|
| [`railway.json`](../railway.json) | Railway deploy config (health check, Dockerfile builder) |
| [`DEPLOY.md`](../DEPLOY.md) | Operator runbook for Railway + Stripe + DNS |
| [`docker-compose.verify.yml`](../docker-compose.verify.yml) | Local Postgres + app image smoke stack |
| [`scripts/check-env.ts`](../scripts/check-env.ts) | CLI env validation |
| [`src/lib/config/env.ts`](../src/lib/config/env.ts) | Source of truth for required/optional env lists |

## DNS

Production hostname: **passport.metis.gold** → Railway app service (CNAME). See [`docs/DNS_SETUP.md`](./DNS_SETUP.md) for DNS details.
