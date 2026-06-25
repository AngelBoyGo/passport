# Passport — Phase 1 MVP

Portable, tamper-evident behavioral receipts for AI agents. Identity gets your agent in the door; Passport tells the other side whether to ship.

**Honesty boundary:** tamper-evident integrity + verifiability — not unforgeable honesty.

## Quick start

Local development requires PostgreSQL (SQLite is no longer supported):

```bash
cd passport
docker run -d --name passport-pg -e POSTGRES_USER=passport -e POSTGRES_PASSWORD=passport -e POSTGRES_DB=passport -p 5432:5432 postgres:16-alpine
```

Set `DATABASE_URL=postgresql://passport:passport@localhost:5432/passport?schema=public` in `.env`, then:

```bash
npm install
npx prisma migrate dev
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and click **Live verify demo**.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | `postgresql://USER:PASSWORD@HOST:5432/passport?schema=public` |
| `SIGNING_PRIVATE_KEY` | Yes | 32-byte ed25519 seed (64 hex chars). Verifier write-only. Never rotate without a key-rotation plan. |
| `NEXT_PUBLIC_APP_URL` | Yes | Public HTTPS origin, e.g. `https://passport.example.com` |
| `STRIPE_SECRET_KEY` | Prod | Stripe secret key. Omit for dev mock mode. |
| `STRIPE_WEBHOOK_SECRET` | Prod | Stripe webhook signing secret |
| `STRIPE_PRICE_PRO` | Prod | Stripe Price ID for Pro ($49/mo recurring) |
| `NODE_ENV` | Prod | Set to `production` (disables dev mock provisioning) |

Copy `.env` and adjust as needed. Generate a signing key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm test` | Run Vitest suite (TDD sign/verify/chain — DB-free) |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run build` | Production build (standalone output) |
| `npm run verify:container` | Build Docker image, run Postgres + app, mock Stripe idempotency proof |

## API

All issuing endpoints require `Authorization: Bearer <api_key>`.

### POST `/api/v1/receipts`

Issue a pending signed receipt (input committed before response).

```json
{
  "agent_id": "agent_fulfillment_1",
  "receipt_type": "competence",
  "input_digest": "<sha256 hex>",
  "authority_scope": "fulfillment.example.com",
  "expiry": "2026-07-13T12:00:00.000Z",
  "prev_receipt_hash": "<optional chain link>"
}
```

Returns signed receipt JSON. Decrements operator credits.

### POST `/api/v1/receipts/:id/finalize`

Finalize with outcome:

```json
{ "status": "success", "output_hash": "<sha256 hex>" }
{ "status": "refusal", "refusal_reason": "<sha256 hex>" }
{ "status": "timeout", "terminal_reason": "<sha256 hex>" }
```

Terminal states: `graceful_shutdown`, `timeout`, `failure_tombstone`.

### GET `/api/v1/public-key`

Published ed25519 verifying key. Open verify logic: `src/lib/receipt/verify.ts`.

### GET `/api/health`

Unauthenticated DB liveness probe. Returns `200 { status: "ok" }` or `503 { status: "unavailable" }`. Use as the Coolify health check path.

### GET `/verify/:receipt_id`

Public verification page — signature check, domain-scoped history, refusals/terminal states. No universal score.

### Dev provisioning

`POST /api/dev/provision` (non-production) creates operator + API key without Stripe.

## Architecture

- **Verifier write-only:** only the API signs receipts (`src/lib/receipt/signer.ts`). Agents query; verifier writes.
- **Hash-only storage:** no raw payloads in DB.
- **Operator identity:** `operator_id` derived from Stripe customer (`op_<cus_...>`).
- **Stripe idempotency:** `StripeEvent` table records processed webhook event ids; duplicate deliveries return HTTP 200 without re-crediting.
- **Separate ledgers:** `MatchLedgerEntry` (settlement) vs `CapabilityLedgerEntry` (reputation).
- **Receipt types:** `custody` vs `competence`; statuses include `refusal`, `null`, and terminal states.

## Tech stack

Next.js App Router (standalone output), TypeScript, Prisma + PostgreSQL, `@noble/ed25519`, Vitest, Stripe SDK, Docker (Alpine multi-stage).

## Coolify self-hosted deployment

### Stripe merchant panel configuration

1. Create a **Product** with a recurring **Price** ($49/mo Pro tier). Copy the Price ID into `STRIPE_PRICE_PRO`.
2. Add a webhook endpoint: `https://<NEXT_PUBLIC_APP_URL>/api/stripe/webhook`
3. Subscribe to events: `checkout.session.completed`, `invoice.payment_succeeded`, `customer.created`
4. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`
5. For staging, use Stripe CLI: `stripe listen --forward-to localhost:3000/api/stripe/webhook`

### Coolify launch protocol

1. **New Resource → Application** from Git repo; base directory `passport/`; build pack **Dockerfile**.
2. Add a **PostgreSQL** database resource; copy its internal connection string into `DATABASE_URL`.
3. Set all env vars above (mark secrets accordingly).
4. Health check path: `/api/health` (expects 200). Container port: `3000`.
5. Deploy. The container entrypoint runs `prisma migrate deploy` then boots `server.js`.
6. Point your domain; confirm `/api/health` is green and `/api/v1/public-key` returns the key.
7. Register the production webhook URL in Stripe; complete one live checkout and confirm Operator + API key are minted exactly once.

### Container boot sequence

The Dockerfile copies the Prisma CLI into the runner image (standalone tracing strips it otherwise). On boot:

```sh
./node_modules/.bin/prisma migrate deploy && node server.js
```

### Known deferred tasks

- **StripeEvent pruning:** the idempotency table grows unbounded under high webhook volume. Phase 1 retains rows indefinitely; a future TTL/cron pruning policy will cap growth.

## License

Private — Phase 1 MVP.

## Branching and pilot freeze

During the pilot-ready substrate period, use feature branches and PR review — do not merge protocol, schema, route, or signing changes without approval. See [docs/branching.md](./docs/branching.md) for workflow, baseline tag `passport-pilot-ready-v1`, and GitHub branch protection steps.

## First External Agent Kit

Documentation for enrolling any external agent with Passport (enrollment + signed evidence):

| Doc | Purpose |
|---|---|
| [docs/first-external-agent.md](./docs/first-external-agent.md) | Concept + hello-world walkthrough |
| [docs/passport-enrollment-ops.md](./docs/passport-enrollment-ops.md) | Operator preflight, smoke verification, diagnosis |
| [docs/passport-agent-enrollment.md](./docs/passport-agent-enrollment.md) | Canonical API contract |
| [../3 aaamigas/docs/passport-client-reference.md](../3%20aaamigas/docs/passport-client-reference.md) | Reference TypeScript client |
| [../3 aaamigas/docs/passport-enrollment-runbook.md](../3%20aaamigas/docs/passport-enrollment-runbook.md) | Fresh-checkout operator runbook |

Minimal sequence: start Postgres + Passport → `BASE_URL=http://localhost:3000 npm run smoke:agent-enrollment` → in 3 aaamigas: `PASSPORT_BASE_URL=http://localhost:3000 npm run demo:repo-steward-passport`.
