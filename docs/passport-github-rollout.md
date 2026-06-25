# Passport + GitHub Evidence: Operator Rollout Runbook

Manual rollout guide for the Passport public portal and GitHub evidence system. This document is additive operator documentation — it does not change application behavior.

## System summary

Passport is a receipt-issuance and verification platform. The GitHub evidence integration adds three completed phases:

- **Phase 1 — Ingestion:** GitHub push webhook events are normalized into `AgentEvidence` rows with privacy-preserving commitments (`INGESTION_COMMITMENT_SALT`). Library-only today — no HTTP route or cron trigger ships ingestion in production yet.
- **Phase 2 — Public analytics:** Always-on, IP rate-limited public endpoints expose masked leaderboards and agent profiles (`/api/v1/leaderboard`, `/api/v1/profiles/:hash`).
- **Phase 3 — Evidence→receipt bridge:** When `EVIDENCE_BRIDGE_OPERATOR_ID` points at a valid `Operator.id`, evidence can be bridged into custody receipts and linked via `EvidenceReceiptLink`. Liability slashing is gated by `EVIDENCE_ENFORCEMENT_ENABLED`.

Public portal routes have **no feature flag** — they are always enabled when the app is deployed.

## Prerequisites

- Access to the staging/prod hosting environment where Passport runs.
- A PostgreSQL `DATABASE_URL` for the rollout target. SQLite/file databases are local-dev only.
- A real `SIGNING_PRIVATE_KEY` for receipt signing.
- A long random `INGESTION_COMMITMENT_SALT` kept stable for the environment.
- A seeded `PUBLIC_EVIDENCE_MINTER` service-principal `Operator` row before enabling `EVIDENCE_BRIDGE_OPERATOR_ID`.
- Stripe values only if billing is enabled for the target environment.
- Ability to run read-only prechecks (`npm run check:env`, `npm run doctor:passport`, `npm run db:status`) before any migration.

## Required environment variables

These must be set in production/staging. `npm run check:env` and `npm run doctor:passport` validate them by **name only** (never prints values).

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Prisma database connection. Must be `postgres://` or `postgresql://` for staging/prod rollout |
| `SIGNING_PRIVATE_KEY` | Ed25519 hex private key for receipt signing |
| `INGESTION_COMMITMENT_SALT` | Salt for privacy-preserving GitHub event commitments |

## Optional / feature environment variables

Missing optional vars degrade gracefully; the app still starts.

| Variable | Default behavior when unset |
|---|---|
| `EVIDENCE_BRIDGE_OPERATOR_ID` | Bridge returns `null` — no evidence receipts minted |
| `EVIDENCE_ENFORCEMENT_ENABLED` | Only `"true"` enables liability slashing; unset = disabled |
| `NEXT_PUBLIC_APP_URL` | Required only when Stripe is configured; used for checkout redirect URLs |
| `ENROLLMENT_CHALLENGE_TTL_SECONDS` | Defaults to 300 seconds for enrollment challenge nonces |
| `ENFORCE_ENROLLMENT_FOR_CREDITS` | Only `"true"` requires ISSUED enrollment for AngelCoin grants/transfers; unset = disabled |

## Stripe conditional group

When `STRIPE_SECRET_KEY` is set, these become **required**:

- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_PRO`
- `NEXT_PUBLIC_APP_URL`

When `STRIPE_SECRET_KEY` is unset, billing falls back to dev/mock mode (no Stripe client).

## Local dev vs staging/prod

- Local dev may use `DATABASE_URL="file:./dev.db"` with SQLite for quick iteration.
- Staging/prod rollout must use PostgreSQL. `npm run doctor:passport` fails staging/prod mode when `DATABASE_URL` is SQLite/file.
- Use `NODE_ENV=staging npm run doctor:passport` or `NODE_ENV=production npm run doctor:passport` for real rollout prechecks.
- Use `BASE_URL=https://passport.example.com npm run smoke:github` against the deployed/staging app. Local `BASE_URL=http://localhost:3000` only proves local behavior.

## Feature flag inventory

There is **no public-portal exposure flag** — leaderboard, profile, and manifest routes are always-on.

- **`EVIDENCE_BRIDGE_OPERATOR_ID`** — Default: unset (bridge disabled). Owner: TBD. Purpose: DB `Operator.id` for the `PUBLIC_EVIDENCE_MINTER` that signs bridged custody receipts. Safe fallback: unset → `bridgeEvidenceToReceipt` returns `null`. Removal criteria: replace with seeded operator provisioning or service account once automated minter setup exists.

- **`EVIDENCE_ENFORCEMENT_ENABLED`** — Default: unset/false. Owner: TBD. Purpose: gates liability slashing in the evidence bridge; only `"true"` enables enforcement. Safe fallback: leave unset during rollout. Removal criteria: enforcement policy finalized and enabled by default with audited rollback path.

- **`INGESTION_COMMITMENT_SALT`** — Default: none in production (hard-fail if missing outside test). Owner: TBD. Purpose: salts GitHub event commitments for privacy. Safe fallback: none in prod — must be set. Removal criteria: N/A (core secret, not a toggle).

- **`STRIPE_SECRET_KEY`** (and conditional trio) — Default: unset → mock billing. Owner: TBD. Purpose: live Stripe checkout and webhooks. Safe fallback: unset → `getStripe()` returns `null`, dev mock checkout used. Removal criteria: production billing fully on Stripe with monitoring.

- **`ENFORCE_ENROLLMENT_FOR_CREDITS`** — Default: unset/false. Owner: TBD. Purpose: when `"true"`, AngelCoin grants and transfers call `requireEnrolled` on the sender/subject commitment. Safe fallback: unset → existing AngelCoin behavior unchanged. See [passport-agent-enrollment.md](./passport-agent-enrollment.md).

- **`ENROLLMENT_CHALLENGE_TTL_SECONDS`** — Default: 300. Owner: TBD. Purpose: lifetime of enrollment challenge nonces stored in `AgentEnrollment`. Safe fallback: unset → 300 seconds.

## Agent enrollment endpoints

Public proof-based enrollment (no API key). See [passport-agent-enrollment.md](./passport-agent-enrollment.md) for the full contract.

- `POST /api/v1/passport/agents/enroll/start` — derive commitment, issue challenge nonce
- `POST /api/v1/passport/agents/enroll/complete` — verify signed nonce, set status `ISSUED`
- `GET /api/v1/passport/agents/:id/passport` — read issued enrollment passport
- `POST /api/v1/passport/agents/:id/evidence` — signed evidence ingestion for enrolled agents

Agent profiles (`GET /api/v1/profiles/:hash`) include additive `enrollment_status` (`ENROLLED` | `UNENROLLED`).

Enrollment smoke:

```bash
BASE_URL=https://passport.example.com npm run smoke:agent-enrollment
```

Pass criteria are the four `[PASS]` lines for `enroll-start`, `enroll-complete`, `evidence-ingest`, and `profile-enrolled`, followed by `All agent enrollment smoke probes passed.` This smoke is not read-only: it writes one enrollment and one evidence record for a deterministic smoke key.

## Migration commands

**Never run `prisma migrate dev` in production.** The `npm run db:migrate` script is dev-only (`prisma migrate dev`).

Production/staging migration:

```bash
npx prisma migrate deploy
```

Preflight (read-only status + client generation):

```bash
npm run db:status      # prisma migrate status
npm run db:preflight   # prisma migrate status && prisma generate
```

`npm run build` and `postinstall` already run `prisma generate`.

Pending migrations (in order):

1. `20260615000000_concurrency_safe_escrow_ledger`
2. `20260616000000_deploy_selective_disclosure_commitments`
3. `20260616100000_add_agent_evidence`
4. `20260616120000_add_evidence_receipt_link`
5. `20260618000000_add_angelcoin_ledger`
6. `20260618200000_add_agent_enrollment`

## Common rollout failures

> Warning: check these before migration or flag enablement.
>
> - Missing `INGESTION_COMMITMENT_SALT` causes ingestion commitments to fail outside test mode.
> - `DATABASE_URL=file:...` or other SQLite/file URLs are local-dev only; staging/prod requires PostgreSQL.
> - `EVIDENCE_BRIDGE_OPERATOR_ID` must not be set until the `PUBLIC_EVIDENCE_MINTER` Operator row exists.
> - `EVIDENCE_ENFORCEMENT_ENABLED=true` should wait until smoke probes and monitoring are healthy.
> - `ENFORCE_ENROLLMENT_FOR_CREDITS=true` should wait until enrollment smoke and consumer integration are healthy.
> - `STRIPE_SECRET_KEY` makes `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, and `NEXT_PUBLIC_APP_URL` required.

## Order of operations

1. Confirm local tests/build were green for the artifact to be deployed.
2. Set staging/prod environment variables in the hosting platform, except leave risky flags disabled.
3. Seed the `PUBLIC_EVIDENCE_MINTER` Operator and capture its `Operator.id`:

```bash
DATABASE_URL=postgresql://... npm run seed:evidence-minter
```

Copy the printed `Operator.id` for the next step. The upsert is idempotent — safe to re-run.

4. Set `EVIDENCE_BRIDGE_OPERATOR_ID` to the seeded minter `Operator.id`; leave `EVIDENCE_ENFORCEMENT_ENABLED=false` or unset.
5. Run `NODE_ENV=staging npm run check:env` (or `NODE_ENV=production npm run check:env`).
6. Run `NODE_ENV=staging npm run doctor:passport` (or `NODE_ENV=production npm run doctor:passport`).
7. Backup the database before any schema change.
8. Run `npm run db:status` and confirm expected pending migrations.
9. Run `npx prisma migrate deploy` against the rollout PostgreSQL database.
10. Deploy the application and verify it starts (`npm run build` produces the production bundle).
11. Run public smoke probes against the deployed/staging app: `smoke:github` first, then `smoke:agent-enrollment`.
12. Keep `ENFORCE_ENROLLMENT_FOR_CREDITS` unset until enrolled consumer traffic is verified; enable it only after smoke probes, logs, and monitoring are healthy.

## Operator commands

```bash
# Env preflight (name-only report; exits 1 on missing required)
NODE_ENV=production npm run check:env

# Release doctor (no DB connection, no mutation)
NODE_ENV=production npm run doctor:passport

# Migration status before deploy
npm run db:status

# Public endpoint smoke (deployed/staging base URL)
BASE_URL=https://passport.example.com npm run smoke:github
BASE_URL=https://staging.passport.example.com npm run smoke:github

# Enrollment smoke (writes one enrollment + evidence record)
BASE_URL=https://passport.example.com npm run smoke:agent-enrollment
npm run smoke:agent-enrollment -- --help

# AngelCoin mutation + passport-live smoke (requires API key + commitment)
PASSPORT_API_KEY=pp_... SUBJECT_COMMITMENT=<64-hex> BASE_URL=https://passport.example.com npm run smoke:angelcoin
npm run smoke:angelcoin -- --help

# Seed PUBLIC_EVIDENCE_MINTER Operator (idempotent; prints Operator.id)
DATABASE_URL=postgresql://... npm run seed:evidence-minter
npm run seed:evidence-minter -- --help

# Help and examples
npm run smoke:github -- --help
npm run smoke:agent-enrollment -- --help

# Local-only smoke while developing
npm run smoke:github

# Optional deep probes when you have known IDs
AGENT_HASH=<64-hex> RECEIPT_ID=<receipt-id> BASE_URL=https://passport.example.com npm run smoke:github

# Build (includes prisma generate)
npm run build

# Test suite
npm test
```

`npm start` runs `prestart` → `check:env --prestart-only`, which enforces env validation **only** when `NODE_ENV` is `production` or `staging`.

## AngelCoin mutation auth and API keys

AngelCoin mutation routes require operator Bearer authentication:

- `POST /api/v1/passport/credits/grants`
- `POST /api/v1/passport/credits/transfers`
- `POST /api/v1/passport/access/evaluate`
- `POST /api/v1/passport/access/override`

Send the raw API key as `Authorization: Bearer <key>`. The server hashes the key with `hashApiKey` and matches it against `ApiKey.keyHash` via `authenticateApiKey` in `src/lib/operator.ts`. Keys are never stored in plaintext.

### Obtaining an API key

**Non-prod / local dev:** provision an operator and emit a one-time raw key:

```bash
npx tsx scripts/provision-dev-operator.ts
```

The script prints JSON containing `apiKey` (prefix `pp_…`). Store it securely; it is shown once.

**Staging/prod:** create an `ApiKey` row for an existing `Operator` using the same `hashApiKey` storage pattern (manual provisioning today — no self-service key UI ships with this release). Coordinate with whoever owns operator records in the target database.

### Example authenticated curls

Replace `BASE_URL`, `PASSPORT_API_KEY`, and 64-hex commitments with real values.

```bash
# Grant credits (creates account if needed)
curl -sS -X POST "$BASE_URL/api/v1/passport/credits/grants" \
  -H "Authorization: Bearer $PASSPORT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"subject_commitment":"<64-hex>","amount":50}'

# Transfer credits between commitments
curl -sS -X POST "$BASE_URL/api/v1/passport/credits/transfers" \
  -H "Authorization: Bearer $PASSPORT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from_commitment":"<64-hex>","to_commitment":"<64-hex>","amount":10}'

# Recompute and persist access tier
curl -sS -X POST "$BASE_URL/api/v1/passport/access/evaluate" \
  -H "Authorization: Bearer $PASSPORT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"subject_commitment":"<64-hex>"}'

# Set or clear admin override tier (tier null clears override)
curl -sS -X POST "$BASE_URL/api/v1/passport/access/override" \
  -H "Authorization: Bearer $PASSPORT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"subject_commitment":"<64-hex>","tier":"FULL"}'
```

Public read routes (`GET …/passport-live`, `GET …/access-tier`, `GET …/credits`, `GET …/credit-journal`) do **not** require a Bearer key.

## AngelCoin smoke probes

Use the dedicated AngelCoin smoke script after deploy to verify authenticated grant + live read:

```bash
PASSPORT_API_KEY=pp_... \
SUBJECT_COMMITMENT=<64-hex> \
BASE_URL=https://passport.example.com \
npm run smoke:angelcoin
```

CLI flags override env vars:

```bash
npm run smoke:angelcoin -- \
  --base-url https://passport.example.com \
  --api-key pp_... \
  --subject-commitment abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789
```

`SUBJECT_COMMITMENT` must be a full 64-character lowercase/uppercase hex string (example format above).

**Pass criteria:**

- `[PASS] grant 201` — `POST /api/v1/passport/credits/grants` succeeds with Bearer auth.
- `[PASS] passport-live 200` — `GET /api/v1/passport/agents/:id/passport-live` returns `accessTier`, `storedAccessTier`, and `availableBalance` reflecting the grant.

The script never prints the API key. Run `npm run smoke:angelcoin -- --help` for usage.

See also: [passport-angelcoin-proof-packet.md](./passport-angelcoin-proof-packet.md) for route inventory and response-shape notes.

## Definition of healthy rollout

After deploy, the rollout is healthy when all of these are true:

- `GET /api/health` returns **200** with `{ "status": "ok" }`.
- `GET /api/v1/leaderboard` returns **200** with `{ "leaderboard": [ ... ] }` (array, may be empty).
- `GET /api/v1/receipts/:id/public-manifest` (when receipt exists) returns **200** with:
  - `masked_fields` array present
  - `enforcement_state` and `linked_liability_event_id` keys present (null when no bridge row)
  - No raw repo names, branch refs, or full URLs in the response body
- `GET /api/v1/profiles/:hash` returns **200** with masked profile shape or **404** when unknown — never **5xx**.
- `BASE_URL=https://passport.example.com npm run smoke:agent-enrollment` prints `[PASS] enroll-start`, `[PASS] enroll-complete`, `[PASS] evidence-ingest`, `[PASS] profile-enrolled`, and `All agent enrollment smoke probes passed.`
- `npm run doctor:passport` reports PostgreSQL for staging/prod mode.
- No public response contains raw repo names, branch refs, or full GitHub URLs.
- `EVIDENCE_ENFORCEMENT_ENABLED` and `ENFORCE_ENROLLMENT_FOR_CREDITS` remain disabled until monitoring is healthy.

Use `npm run smoke:github` to automate these checks.

## Rollback guidance

### Rollback first moves (no schema change)

- **Stop minting:** Unset `EVIDENCE_BRIDGE_OPERATOR_ID` and redeploy. Bridge immediately returns `null`.
- **Disable liability:** Keep `EVIDENCE_ENFORCEMENT_ENABLED` unset or set to anything other than `"true"`.
- **Disable enrollment credit gating:** Keep `ENFORCE_ENROLLMENT_FOR_CREDITS` unset or set to anything other than `"true"`.
- **Stop new traffic if needed:** Roll back the app deployment to the prior artifact or route traffic away from the new release.
- **Re-run smoke:** `BASE_URL=https://passport.example.com npm run smoke:github` after rollback to confirm public endpoints recover.

### Symptoms that should trigger rollback

- Sustained **5xx** on public portal endpoints (`/api/health`, `/api/v1/leaderboard`, profiles, manifests).
- Unexpected custody receipts being minted from evidence.
- `/api/health` returning **503** (`{ "status": "unavailable" }`) indicating DB connectivity failure.

### Schema rollback (last resort)

Ledger and ingestion tables are independent. If the bridge link table must be removed:

- Drop or revert the `EvidenceReceiptLink` migration only (`20260616120000_add_evidence_receipt_link`).
- Do **not** roll back escrow ledger or `AgentEvidence` ingestion migrations unless explicitly required.

Coordinate schema rollback with a DB backup restore if data integrity is uncertain.

## Operational assumptions and gaps

- **No production ingestion trigger:** Evidence ingestion is library-only. Something external (webhook handler, worker, cron) must call the adapter — none ships with this release.
- **Minter Operator seeding:** Run `npm run seed:evidence-minter` against the rollout PostgreSQL database before setting `EVIDENCE_BRIDGE_OPERATOR_ID`.
- **In-memory rate limiter:** Public portal rate limits are per-process, not shared across instances.
- **Rate limit false positives:** Heavy probing from a single IP may hit 429 during smoke tests; retry after `Retry-After` if present.

## Related scripts

| Script | Purpose |
|---|---|
| `npm run check:env` | Validates env vars by name; exits 1 on missing required |
| `npm run smoke:github` | Read-only HTTP probes of public endpoints |
| `npm run smoke:angelcoin` | Authenticated grant + passport-live read probes |
| `npm run smoke` | Local provisioning e2e (issues receipts) — **not** a prod smoke test |
| `npm run db:status` | `prisma migrate status` |
| `npm run db:preflight` | Status check + `prisma generate` |
| `npm run seed:evidence-minter` | Idempotent upsert of `PUBLIC_EVIDENCE_MINTER` Operator; prints `Operator.id` |
