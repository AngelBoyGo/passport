# Passport enrollment — operator checklist

One-screen preflight, verification, and diagnosis for agent enrollment. Contract details: [passport-agent-enrollment.md](./passport-agent-enrollment.md). Integration guide: [first-external-agent.md](./first-external-agent.md).

## Preflight

### 1. Dependencies and database

```bash
cd passport
npm install
# Copy .env.example -> .env and adjust values if needed.
npx prisma migrate deploy
npm run db:preflight   # expect: Database schema is up to date!
```

Passport requires **PostgreSQL**. Set `DATABASE_URL` to a reachable PostgreSQL
connection string (see [README.md](../README.md) for the local Docker example)
before running preflight. SQLite is not supported for enrollment or production
rollout.

### 2. Required environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `SIGNING_PRIVATE_KEY` | 64-hex ed25519 seed (verifier signing) |
| `INGESTION_COMMITMENT_SALT` | Stable salt for evidence commitment derivation |
| `NEXT_PUBLIC_APP_URL` | Public origin (e.g. `http://localhost:3000`) |

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # SIGNING_PRIVATE_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # INGESTION_COMMITMENT_SALT (dev)
```

Copy `.env.example` → `.env` and fill values.

### 3. Env and doctor checks

```bash
npm run check:env        # reports set/MISSING by name (never prints values)
npm run doctor:passport  # read-only rollout plan; fails on missing required vars
```

Both load `.env` when keys are not already in the environment.

### 4. Start server

Reliable local development path on Windows:

```powershell
npm run check:env
npm run db:status
$env:NEXT_PUBLIC_APP_URL = "http://localhost:3000"
npm run dev
```

If a server is already healthy on `http://localhost:3000`, reuse it instead of
restarting. `npm run dev:passport-stack` remains a helper, but the direct
preflights plus `npm run dev` path above is the stable Windows operator path.
For production-style local checks, use `npm run build && npm start`.

Health probe:

```bash
curl http://localhost:3000/api/health
# {"status":"ok"}
```

## Verification

### Running a local Passport dev server for external agents

Prerequisites:

- Run commands from `C:\Users\izzyb\Downloads\continual-harness-main\passport`.
- Ensure `.env` exists and `DATABASE_URL`, `SIGNING_PRIVATE_KEY`,
  `INGESTION_COMMITMENT_SALT`, and `NEXT_PUBLIC_APP_URL` are set.
- Ensure the configured database is reachable. Local PostgreSQL should be
  listening before you start the server when `DATABASE_URL` points at Postgres.

PowerShell:

```powershell
cd "C:\Users\izzyb\Downloads\continual-harness-main\passport"
npm run check:env
npm run db:status
$env:NEXT_PUBLIC_APP_URL = "http://localhost:3000"
npm run dev
```

In another PowerShell window:

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/api/health" -Headers @{Accept="application/json"} -UseBasicParsing
$env:BASE_URL = "http://localhost:3000"
npm run smoke:agent-enrollment
```

Point 3 aaamigas at the local Passport server:

```powershell
cd "C:\Users\izzyb\Downloads\continual-harness-main\3 aaamigas"
$env:PASSPORT_BASE_URL = "http://localhost:3000"
```

For Bash-style external agents, set `PASSPORT_BASE_URL=http://localhost:3000`
before running the agent process.

Success criteria:

- `/api/health` returns HTTP 200 with `{"status":"ok"}`.
- `npm run check:env` ends with `Environment check passed.`
- `npm run db:status` prints `Database schema is up to date!`
- `npm run smoke:agent-enrollment` prints all four `[PASS]` lines and
  `SMOKE_PASS agent-enrollment`.

Run provider-side enrollment smoke against a live server:

```bash
BASE_URL=http://localhost:3000 npm run smoke:agent-enrollment
```

**Success criteria** — all lines must PASS:

```
[PASS] enroll-start 200 ...
[PASS] enroll-complete 200 ...
[PASS] evidence-ingest 201 ...
[PASS] profile-enrolled 200 ...
All agent enrollment smoke probes passed.
SMOKE_PASS agent-enrollment
```

Consumer-side equivalent (3 aaamigas reference client):

PowerShell:

```powershell
cd "C:\Users\izzyb\Downloads\continual-harness-main\3 aaamigas"
$env:PASSPORT_BASE_URL = "http://localhost:3000"
npm run demo:repo-steward-passport
npm run demo:issue-triage-passport
npm run demo:compliance-passport
```

Bash:

```bash
cd "../3 aaamigas"
export PASSPORT_BASE_URL=http://localhost:3000
npm run demo:repo-steward-passport
npm run demo:issue-triage-passport
npm run demo:compliance-passport
```

Expect each demo to report enrollment/evidence status, including `ISSUED`,
`ENROLLED`, and profile `enrollment_status: "ENROLLED"`. On the Passport side,
the Next dev console should show 2xx requests for enrollment, evidence, and
profile routes.

## Diagnosis

### Enrollment failures

| HTTP | Error (typical) | Meaning | Action |
|---:|---|---|---|
| 400 | Invalid JSON / zod error | Malformed request body | Fix JSON and field shapes per contract |
| 400 | Enrollment commitment mismatch | Local derivation ≠ server | Lowercase public key hex; verify context string |
| 401 | Invalid enrollment proof | Bad challenge signature | Sign `UTF-8(challenge_nonce)` with matching private key |
| 404 | Enrollment challenge not found | Missing or replayed nonce | Call `enroll/start` again; do not reuse old nonce |
| 410 | Enrollment challenge expired | TTL exceeded (default 300s) | Restart enrollment from `enroll/start` |
| 429 | Rate limit exceeded | IP throttled | Wait for `Retry-After` or reduce request rate |

### Evidence failures

| HTTP | Error (typical) | Meaning | Action |
|---:|---|---|---|
| 400 | Malformed body / invalid source_type | Payload or type rejected | Use supported `source_type`; normalize payload |
| 401 | Invalid enrollment proof | Bad evidence signature | Sign `UTF-8(sourceDigest(payload))`, not raw payload |
| 403 | Agent is not enrolled | No ISSUED enrollment for `:id` | Complete enroll/complete before evidence |
| 400 | agent_commitment_hash must be… | Bad path segment | Use full 64-hex `subject_commitment` |

### Suspicious `enrollment_status` on profile

| Profile value | Likely cause | Action |
|---|---|---|
| `UNENROLLED` | No ISSUED row, or PENDING only, or no evidence yet | Complete enrollment; submit signed evidence |
| `PENDING` | (internal) challenge outstanding | Finish `enroll/complete` |
| Missing / wrong commitment | Wrong hash in URL | Derive commitment from enrolled public key |
| `ENROLLED` | ISSUED + evidence persisted | Expected success state |

Full status semantics: [passport-agent-enrollment.md#status-semantics](./passport-agent-enrollment.md#status-semantics).

### Smoke / demo still failing?

1. Confirm `/api/health` returns 200.
2. Run `npm run check:env` — no MISSING required vars.
3. Re-run `npx prisma migrate deploy`.
4. Compare consumer payload against contract curl examples.
5. Run `BASE_URL=... npm run smoke:agent-enrollment` to isolate provider vs consumer.
6. If Next suggests port 3001 or the health probe hangs, stop the stale process on port 3000 and rerun the direct local path: `npm run check:env`, `npm run db:status`, then `npm run dev`.

## Rate / volume limit assumptions

Enrollment and evidence routes share a **named per-endpoint rate limit** backed by the in-memory limiter in `src/lib/rateLimit.ts`:

| Route | Bucket key prefix | Default |
|---|---|---|
| `POST .../enroll/start` | `enroll-start:<ip>` | 30 req / 60s |
| `POST .../enroll/complete` | `enroll-complete:<ip>` | 30 req / 60s |
| `POST .../agents/:id/evidence` | `enroll-evidence:<ip>` | 30 req / 60s |

Limits are **per client IP** (from `x-forwarded-for` or `x-real-ip`) and **per Passport instance**. There is no shared Redis or edge store yet — behind multiple replicas each instance tracks its own counters, so effective throughput scales roughly with instance count until a shared limiter is added.

Tune without code changes:

| Variable | Default | Purpose |
|---|---|---|
| `ENROLLMENT_RATE_LIMIT_MAX` | `30` | Max requests per IP per window across enrollment/evidence routes |
| `ENROLLMENT_RATE_LIMIT_WINDOW_MS` | `60000` | Sliding window length in milliseconds |

When exceeded, routes return HTTP **429** with `{ "error": "Rate limit exceeded" }` and a **`Retry-After`** header (seconds). Gate verify (`POST /api/v1/gate/verify`) keeps its separate `GATE_VERIFY_*` defaults.

## Logging

Enrollment and evidence routes emit **one JSON line per request** to stdout (stderr for 5xx / `outcome: "error"`). The logger never throws and never logs request bodies, signatures, public keys, nonces, or raw payloads.

| `event` | Route | Typical `outcome` values |
|---|---|---|
| `enroll_start` | `POST .../enroll/start` | `pending`, `issued`, `rejected`, `error` |
| `enroll_complete` | `POST .../enroll/complete` | `issued`, `rejected`, `error` |
| `evidence_ingest` | `POST .../agents/:id/evidence` | `issued`, `rejected`, `error` |

Fields (privacy-safe only):

- `event`, `outcome`, `http_status`, `reason_code` (e.g. `rate_limit_exceeded`, `validation_error`)
- `subject_commitment` (hash), `source_type` (evidence only), `event_commitment_hash` (evidence success)
- `rate_limited` (boolean), `latency_ms`

Implementation: `src/lib/observability/logger.ts`.

## Health + contract check

Run the first-party read-only contract checker against any deployment (local or remote):

```bash
npm run check:contract -- --base-url http://localhost:3000
npm run check:contract -- --base-url https://passport.example.com --subject-commitment <64-hex> --expect-enrollment-status ENROLLED
```

Checks:

1. `GET /api/health` → HTTP 200 and `{ "status": "ok" }`
2. `GET /api/v1/public-key` → non-empty `public_key`
3. `GET /api/v1/passport/agents/<throwaway-64hex>/passport` → HTTP **404** (AgentEnrollment table present; agent not found). HTTP **5xx** fails the check (migration drift).
4. When `--subject-commitment` is supplied: `GET /api/v1/profiles/:hash` includes `enrollment_status` and does **not** expose APF-owned `completeness` / `gaps`

Exit code **0** prints `PASS`; **1** prints `FAIL` with per-check reasons. See also [first-external-agent.md](./first-external-agent.md) and [audit-packet-factory-integration.md](./audit-packet-factory-integration.md).

## Launch readiness gate

Run this sequence **before sending external traffic** to a new deployment. Copy-paste local pilot env: [pilot-support-runbook.md — PILOT_ENVIRONMENT_EXAMPLE](./pilot-support-runbook.md#pilot_environment_example). Consolidated failure triage: [COMMON_FAILURES](./pilot-support-runbook.md#common_failures).

```bash
npm run check:env
npm run doctor:passport
npx prisma migrate deploy
npm run db:status          # expect: Database schema is up to date!
# start the server (dev or production)
npm run check:contract -- --base-url http://localhost:3000
```

Expected contract-check output (all named checks PASS):

```
PASS health
PASS public_key
PASS enrollment_readiness
PASS
```

Optional post-enrollment verification (supply a known enrolled commitment):

```bash
npm run check:contract -- --base-url http://localhost:3000 \
  --subject-commitment <64-hex> --expect-enrollment-status ENROLLED
```

Safe defaults to confirm before launch:

- **Rate limits**: `ENROLLMENT_RATE_LIMIT_MAX=30`, `ENROLLMENT_RATE_LIMIT_WINDOW_MS=60000` (per-IP, per-instance; no shared store yet).
- **Credit enforcement**: `EVIDENCE_ENFORCEMENT_ENABLED=false` by default — credits are not enforced until explicitly enabled.
- **Multi-instance caveat**: in-memory rate limits do not share counters across replicas; effective throughput scales roughly with instance count.
