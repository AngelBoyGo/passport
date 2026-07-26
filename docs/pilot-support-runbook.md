# Passport pilot support runbook

Operator-facing guide for supporting **Repo Passport** and **Audit Packet Factory (APF)** pilots that depend on Passport as the receipt-evidence substrate. This doc is additive ops guidance only - it does not change protocol, schema, routes, signing, or receipt format.

Related docs:

- [passport-enrollment-ops.md](./passport-enrollment-ops.md) - enrollment preflight, diagnosis, launch readiness gate
- [audit-packet-factory-integration.md](./audit-packet-factory-integration.md) - APF payload shape and boundaries
- [first-external-agent.md](./first-external-agent.md) - enrollment + evidence model for external agents
- [accountability-without-surveillance.md](./accountability-without-surveillance.md) - action-first forensic model vs identity surveillance
- [disaster-recovery.md](./disaster-recovery.md) - PostgreSQL backup, restore verify, RPO/RTO placeholders
- [key-management.md](./key-management.md) - signing key escrow, manual rotation, `/api/v1/public-key` verification

---

## PILOT_ENVIRONMENT_EXAMPLE

Opinionated copy-paste local pilot setup. Run all commands from `passport/` unless noted.

### Gotcha: `.env.example` defaults to SQLite

The checked-in [`.env.example`](../.env.example) sets `DATABASE_URL="file:./dev.db"`. **Pilot operators must override to PostgreSQL** — SQLite is local/dev-only and is not pilot-ready for enrollment or evidence.

### PostgreSQL (Docker)

From [README.md](../README.md):

```powershell
docker run -d --name passport-pg -e POSTGRES_USER=passport -e POSTGRES_PASSWORD=passport -e POSTGRES_DB=passport -p 5432:5432 postgres:16-alpine
```

### `.env` template (placeholders only)

Copy `.env.example` → `.env`, then replace values:

```env
DATABASE_URL="postgresql://passport:<DB_PASSWORD>@localhost:5432/passport?schema=public"
SIGNING_PRIVATE_KEY="<64-hex-ed25519-seed>"
INGESTION_COMMITMENT_SALT="<64-hex-random-salt>"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
EVIDENCE_ENFORCEMENT_ENABLED="false"
```

Generate secrets:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Reachable PostgreSQL connection string |
| `SIGNING_PRIVATE_KEY` | Real 64-hex ed25519 seed for verifier signing |
| `INGESTION_COMMITMENT_SALT` | Stable salt for evidence commitment derivation |
| `NEXT_PUBLIC_APP_URL` | Public Passport origin used by downstream clients |
| `EVIDENCE_ENFORCEMENT_ENABLED` | Leave `false` for pilot unless credits are explicitly in scope |

### Command sequence

```powershell
cd "C:\Users\izzyb\Downloads\continual-harness-main\passport"
npm install
npx prisma migrate deploy
npm run check:env
npm run doctor:passport
npm run db:status
$env:NEXT_PUBLIC_APP_URL = "http://localhost:3000"
npm run dev
# In a second terminal:
npm run check:contract -- --base-url http://localhost:3000
# Optional — writes test rows to the pilot database:
$env:BASE_URL = "http://localhost:3000"
npm run smoke:agent-enrollment
```

Expected endings: `Environment check passed.`, `Passport doctor passed.`, `Database schema is up to date!`, contract check prints `PASS`, optional smoke prints `SMOKE_PASS agent-enrollment`.

---

## COMMON_FAILURES

Consolidated failure reference for Passport operators and downstream Repo Passport / APF clients. Full triage steps: [First Incident Triage](#first-incident-triage).

| Symptom | Likely cause | Inspect first |
|---|---|---|
| `ECONNREFUSED` / fetch failed from Repo Passport or APF | Passport server down, wrong `PASSPORT_BASE_URL`, firewall | `curl <base>/api/health`; confirm server running; rerun `check:contract` |
| `FAIL enrollment_readiness` HTTP 500 | Missing `AgentEnrollment` migration | `npm run db:status`; `npx prisma migrate deploy` |
| HTTP 503 on `/api/health` | PostgreSQL unreachable | `DATABASE_URL`, DB process, `check:env` |
| HTTP 403 + `not_enrolled` on evidence | Enrollment not completed or wrong `subject_commitment` in path | Passport log `reason_code: "not_enrolled"`; `GET /api/v1/profiles/:hash`; contract check with `--subject-commitment` |
| HTTP 401 + `invalid_proof` on enroll/complete | Wrong private key or signed wrong bytes | Log `enroll_complete` `reason_code: "invalid_proof"`; re-sign `UTF-8(challenge_nonce)` |
| HTTP 401 + `invalid_proof` on evidence | Signed raw JSON instead of `sourceDigest(payload)` | Log `evidence_ingest` `invalid_proof`; recompute digest per [passport-client-reference.md](../../3%20aaamigas/docs/passport-client-reference.md) |
| HTTP 429 | Rate limit (30/min per IP per instance) | `Retry-After` header; wait and retry |
| Smoke passes, downstream demo fails | Client-side config/signing, not Passport | Compare demo output to failing client; rerun `demo:repo-steward-passport` or `demo:compliance-passport` |

Additional contract-check failures (`FAIL health`, `FAIL public_key`, HTTP 400 on `enroll-start`, malformed body) map to the same rows above — see [Pilot Preflight](#pilot-preflight).

---

## INTEGRATION CHECKLIST

Per-product operator checklists for connecting Repo Passport or APF to a live Passport deployment. Ops tracking checklist: [Pilot Integration Checklist (Ops Tracking)](#pilot-integration-checklist-ops-tracking).

### Repo Passport operator

- Receive `PASSPORT_BASE_URL` matching the live deployment (same origin as `NEXT_PUBLIC_APP_URL`).
- Generate or load ed25519 keypair; enrollment context `passport-v1`.
- Enroll once (`enroll/start` → sign challenge → `enroll/complete`); persist issued `subject_commitment` and public key.
- Use `source_type`: `github_push_webhook`, `github_commit_payload`, or `github_issue_event`.
- Sign `UTF-8(sourceDigest(payload))`; POST evidence; expect HTTP 201 + `enrollment_status: "ENROLLED"`.
- Store `event_commitment_hash` on the receipt record; verify profile readback (`GET /api/v1/profiles/:subject_commitment`).
- Reference demo: `npm run demo:repo-steward-passport` from `3 aaamigas`.

### APF operator

- Receive `PASSPORT_BASE_URL` matching the live deployment.
- Generate or load ed25519 keypair; enrollment context `passport-v1`.
- Enroll once; persist issued `subject_commitment` and public key.
- Use `source_type: "compliance_report"` with the narrow APF payload shape ([audit-packet-factory-integration.md](./audit-packet-factory-integration.md)).
- Sign digest; POST evidence; expect HTTP 201 + `event_commitment_hash` + `enrollment_status: "ENROLLED"`.
- Store Passport fields on the APF receipt row; keep `completeness` / `gaps` APF-side only.
- Reference demo: `npm run demo:compliance-passport` from `3 aaamigas`.

---

## Pilot Preflight

Run this exact sequence **before sending Repo Passport or APF pilot traffic** to a Passport deployment. Commands run from `C:\Users\izzyb\Downloads\continual-harness-main\passport` unless noted. Replace `http://localhost:3000` with the deployed Passport base URL for remote checks.

For copy-paste local setup (Docker Postgres, `.env` placeholders, full command sequence), start at [PILOT_ENVIRONMENT_EXAMPLE](#pilot_environment_example).

### Ordered Launch Gate

1. Confirm required environment and rollout posture (values in [PILOT_ENVIRONMENT_EXAMPLE](#pilot_environment_example)):

```powershell
cd "C:\Users\izzyb\Downloads\continual-harness-main\passport"
npm run check:env
npm run doctor:passport
```

Expected output endings:

```text
Environment check passed.
Passport doctor passed.
```

Passport pilot support assumes **PostgreSQL with migrations applied** and real signing secrets. Do not use the SQLite default from `.env.example`.

2. Apply migrations, then confirm migration status:

```powershell
npx prisma migrate deploy
npm run db:status
```

Expected status line:

```text
Database schema is up to date!
```

3. Start or confirm the Passport server:

```powershell
$env:NEXT_PUBLIC_APP_URL = "http://localhost:3000"
npm run dev
```

If the target deployment is already running and healthy, do not restart it just for the check. For a production-style local run, use:

```powershell
npm run build
npm start
```

4. Run the read-only contract check:

```powershell
npm run check:contract -- --base-url http://localhost:3000
```

Expected output:

```text
PASS health
PASS public_key
PASS enrollment_readiness
PASS
```

What the contract check proves at the deployment boundary:

| Check | Probe | Pilot-ready output |
|---|---|---|
| `health` | `GET /api/health` | HTTP 200 with `{ "status": "ok" }` |
| `public_key` | `GET /api/v1/public-key` | HTTP 200 with non-empty `public_key` |
| `enrollment_readiness` | `GET /api/v1/passport/agents/000...000/passport` | HTTP 404, meaning the enrollment table exists and the throwaway agent is simply not enrolled |

5. Run provider smoke only after you are comfortable writing test rows to the pilot database:

```powershell
$env:BASE_URL = "http://localhost:3000"
npm run smoke:agent-enrollment
```

Expected output shape:

```text
=== Passport agent enrollment smoke ===

Base URL: http://localhost:3000
Subject commitment: <12-char-prefix>...
Public key: <12-char-prefix>...

[PASS] enroll-start 200 http://localhost:3000/api/v1/passport/agents/enroll/start
[PASS] enroll-complete 200 http://localhost:3000/api/v1/passport/agents/enroll/complete
[PASS] evidence-ingest 201 http://localhost:3000/api/v1/passport/agents/<64-hex>/evidence
[PASS] profile-enrolled 200 http://localhost:3000/api/v1/profiles/<64-hex>

All agent enrollment smoke probes passed.
SMOKE_PASS agent-enrollment
```

6. If smoke prints a `Subject commitment`, rerun the contract check with readback:

```powershell
npm run check:contract -- --base-url http://localhost:3000 `
  --subject-commitment <64-hex> --expect-enrollment-status ENROLLED
```

Expected output includes:

```text
PASS profile_readback
PASS
```

This confirms the public profile returns `enrollment_status` for the enrolled subject and does not expose APF-owned `completeness` / `gaps`.

7. Run downstream-shaped demos from `3 aaamigas`:

```powershell
cd "C:\Users\izzyb\Downloads\continual-harness-main\3 aaamigas"
$env:PASSPORT_BASE_URL = "http://localhost:3000"
npm run demo:repo-steward-passport
npm run demo:issue-triage-passport
npm run demo:compliance-passport
```

Expected downstream signals are enrollment `ISSUED`, evidence `ENROLLED`, and profile `enrollment_status: "ENROLLED"` for each demo.

### Misconfiguration vs. Real Bug

See the consolidated [COMMON_FAILURES](#common_failures) table for symptoms, likely causes, and first inspections. Treat contract-check failures, connection errors, migration drift, signing mistakes, and rate limits as deployment/client misconfiguration before escalating as a Passport bug.

Escalate as a possible Passport bug only after the ordered gate passes and a minimal repro still fails with:

- The exact command or HTTP request.
- The HTTP status and response body.
- The matching Passport JSON log line.
- `npm run check:contract` output from the same base URL.

---

## Downstream Client Checklist

Use this checklist when handing a live Passport deployment to **Repo Passport** or **APF** operators. Both use the same enrollment and signed-evidence substrate; downstream tools own receipt wording, packet completeness, GitHub placement, and reviewer/customer UX.

### Values Operators Must Receive

| Value | Who needs it | Notes |
|---|---|---|
| Passport base URL | Repo Passport and APF | Example local value: `http://localhost:3000`; deployed value should match `NEXT_PUBLIC_APP_URL` |
| Agent ed25519 private-key reference | Repo Passport and APF | Do not paste the raw private key into tickets or logs; downstream client uses it to sign challenges and evidence digests |
| Agent public key | Repo Passport and APF | 64-hex lowercase ed25519 public key used by `enroll/start` |
| Enrollment context | Repo Passport and APF | Default context is `passport-v1` unless explicitly overridden |
| Issued `subject_commitment` | Repo Passport and APF | Persist from enrollment response; use as `:subject_commitment` in evidence path |
| Allowed `source_type` | Repo Passport and APF | Repo Passport: `github_push_webhook`, `github_commit_payload`, `github_issue_event`; APF: `compliance_report` |
| Payload digest rule | Repo Passport and APF | Compute `payload_digest = sourceDigest(payload)` with Passport-compatible canonical JSON |
| Signature rule | Repo Passport and APF | Enrollment signs `UTF-8(challenge_nonce)`; evidence signs `UTF-8(payload_digest)` |

### Client Flow

1. Set client base URL:

```powershell
$env:PASSPORT_BASE_URL = "https://passport.example.com"
```

Provider smoke uses `BASE_URL`; downstream demo/client scripts use `PASSPORT_BASE_URL`.

2. Enroll once:

```text
POST /api/v1/passport/agents/enroll/start
POST /api/v1/passport/agents/enroll/complete
```

Success response shape:

```json
{
  "subject_commitment": "<64-hex>",
  "status": "ISSUED",
  "issued_at": "<iso-date>",
  "public_key": "<64-hex>",
  "context": "passport-v1"
}
```

Expected Passport log lines:

```json
{"event":"enroll_start","outcome":"pending","http_status":200,"subject_commitment":"<64-hex>","rate_limited":false,"latency_ms":30}
{"event":"enroll_complete","outcome":"issued","http_status":200,"subject_commitment":"<64-hex>","rate_limited":false,"latency_ms":30}
```

3. Submit signed evidence:

```text
POST /api/v1/passport/agents/<subject_commitment>/evidence
```

Request body:

```json
{
  "source_type": "compliance_report",
  "payload": {},
  "signature": "<128-hex-ed25519-signature>"
}
```

Success response expectations:

| Item | Expected |
|---|---|
| HTTP status | `201` |
| Response fields | `event_commitment_hash`, `enrollment_status: "ENROLLED"` |
| Passport log | `event: "evidence_ingest"`, `outcome: "issued"`, `http_status: 201`, matching `subject_commitment` and `source_type` |
| Profile readback | `GET /api/v1/profiles/<subject_commitment>` returns HTTP 200 and `enrollment_status: "ENROLLED"` |

Example evidence success log:

```json
{"event":"evidence_ingest","outcome":"issued","http_status":201,"subject_commitment":"<64-hex>","source_type":"compliance_report","event_commitment_hash":"<64-hex>","rate_limited":false,"latency_ms":30}
```

### Common Downstream Failures

See [COMMON_FAILURES](#common_failures) for HTTP status, log `reason_code`, and operator actions in one table.

Additional validation failures (HTTP 400, `reason_code: "validation_error"` or `"invalid_json"`) — fix JSON shape, hex field lengths, or `source_type` before re-enrolling.

### Repo Passport Notes

- Use Repo Passport source types: `github_push_webhook`, `github_commit_payload`, or `github_issue_event`.
- Reference demos: `npm run demo:repo-steward-passport` and `npm run demo:issue-triage-passport` from `3 aaamigas`.
- Repo Passport should store Passport `event_commitment_hash` and `enrollment_status` alongside its own receipt artifacts and GitHub-facing draft comments.

### APF Notes

- Use `source_type: "compliance_report"` for APF evidence.
- Reference demo: `npm run demo:compliance-passport` from `3 aaamigas`.
- APF owns `completeness`, `gaps`, packet artifact digests, and customer-facing audit language. Passport normalizes fields it understands and ignores unknown payload fields without schema expansion.
- APF public verify views should re-derive `sourceDigest(payload)`, verify the ed25519 signature, and display Passport `eventCommitmentHash`, `subjectCommitment`, and `enrollmentStatus` alongside APF-owned fields.

See [audit-packet-factory-integration.md](./audit-packet-factory-integration.md) for the narrow APF payload shape and intentional boundaries.

---

## First Incident Triage

Use this mini-playbook for the first pilot submission failure. The goal is to decide quickly whether the issue is deployment readiness, downstream client signing/enrollment, or a hard Passport blocker.

> **Profile 404 before first evidence is expected, not "broken Passport."**
> A `GET /api/v1/profiles/:subject_commitment` returning HTTP 404 means the public profile surface has no row yet — common before enrollment completes or before the first successful evidence ingest. Treat 404 as an **informational** readback signal during triage, not automatic proof that Passport is down. Confirm deployment with contract check and logs first. See [accountability-without-surveillance.md](./accountability-without-surveillance.md).

### Triage order (action-primary forensics)

Run these steps **in order** before deep-diving client code:

| Step | Action | Command / signal |
|------|--------|------------------|
| 1. **Contract check** | Is the deployment reachable and migrations applied? | `npm run check:contract -- --base-url <url>` |
| 2. **Logs by event / reason_code** | What did Passport reject and why? | Grep `evidence_ingest`, `enroll_complete`, `reason_code` ([§2 below](#2-inspect-passport-logs-first)) |
| 3. **Forensic verify** | Does the captured payload digest + signature verify locally? | `npm run verify:receipt -- --payload <file> --signature <128-hex> --public-key <64-hex>` (optional `--base-url` + `--subject-commitment` for readback) |
| 4. **Profile readback** | Enrollment state on public surface (last) | `npm run check:contract -- --base-url <url> --subject-commitment <hash> --expect-enrollment-status ENROLLED` |

Steps 1–3 can pass while step 4 still shows 404 or `UNENROLLED` — that usually means enrollment or evidence never completed, not a broken substrate.

### 1. Capture the Failing Submission

Record:

- Passport base URL.
- Downstream client name: Repo Passport or APF.
- Exact route and HTTP method.
- HTTP status and response body.
- `subject_commitment` used in the path.
- `source_type`.
- Timestamp/window for matching Passport logs.

Do not copy raw private keys, request bodies with customer-sensitive content, signatures, public keys, or nonces into shared incident notes unless the operator channel is approved for those values.

### 2. Inspect Passport Logs First

Enrollment and evidence routes emit one JSON line per request to **stdout**; lines with **HTTP 5xx** or **`outcome: "error"`** go to **stderr**. Privacy-safe fields only are logged: `event`, `outcome`, `http_status`, `reason_code`, `subject_commitment`, `source_type`, `event_commitment_hash`, `rate_limited`, `latency_ms`.

**Log grep recipes (pilot):**

```powershell
# Evidence ingest for a subject (replace prefix)
Select-String -Pattern '"event":"evidence_ingest".*"subject_commitment":"<64-hex>"' passport.log

# Rejected evidence
Select-String -Pattern '"reason_code":"not_enrolled"' passport.log
Select-String -Pattern '"event":"evidence_ingest".*"reason_code":"invalid_proof"' passport.log

# Enrollment signature failures
Select-String -Pattern '"event":"enroll_complete".*"reason_code":"invalid_proof"' passport.log

# Server/runtime errors (capture stderr separately)
Select-String -Pattern '"outcome":"error"' passport.stderr.log
Select-String -Pattern '"http_status":500' passport.stderr.log
```

Unix/grep equivalents:

```bash
grep '"event":"evidence_ingest"' passport.log | grep '<64-hex-prefix>'
grep '"reason_code":"not_enrolled"' passport.log
grep '"reason_code":"invalid_proof"' passport.log
grep '"outcome":"error"' passport.stderr.log
```

Look for these in order:

1. `evidence_ingest` with the failing `subject_commitment` and `source_type`.
2. `enroll_complete` with the same `subject_commitment`.
3. `enroll_start` for the same `subject_commitment`.
4. Any `http_status: 500` / `outcome: "error"` near the incident timestamp.

Fast reads:

| Log signal | Meaning | Next step |
|---|---|---|
| `evidence_ingest` `http_status: 201` | Passport accepted evidence; failure is likely downstream persistence/rendering | Check downstream receipt/packet storage |
| `reason_code: "not_enrolled"` | Evidence arrived before issued enrollment or with wrong commitment | Check enrollment state/readback below |
| `reason_code: "invalid_proof"` on `enroll_complete` | Bad challenge signature | Re-enroll with matching private key and challenge nonce |
| `reason_code: "invalid_proof"` on `evidence_ingest` | Bad evidence digest/signature | Recompute `sourceDigest(payload)` over the exact submitted payload |
| `reason_code: "validation_error"` | Shape/source type/path validation failed | Compare body to the client checklist |
| `http_status: 500` or `internal_error` | Possible DB/runtime issue | Run the deployment checks before touching client code |

### 3. Check Enrollment State

If you have the failing commitment:

```powershell
npm run check:contract -- --base-url http://localhost:3000 `
  --subject-commitment <64-hex> --expect-enrollment-status ENROLLED
```

Read the result:

| Output | Interpretation |
|---|---|
| `PASS profile_readback` | The profile is readable and reports the expected enrollment state |
| `FAIL profile_readback - profile endpoint returned HTTP 404` | The commitment is unknown to the public profile surface |
| `FAIL profile_readback - enrollment_status was UNENROLLED, expected ENROLLED` | Enrollment/evidence did not complete for that commitment |
| `FAIL profile_readback - agent_commitment_hash did not match...` | Client is mixing commitments |
| `FAIL profile_readback - Passport profile exposed APF-owned completeness/gaps` | Boundary regression; escalate as a Passport issue |

If the profile check fails but `enroll_complete` logs show `http_status: 200`, rerun provider smoke against the same base URL to isolate Passport from downstream client code:

```powershell
$env:BASE_URL = "http://localhost:3000"
npm run smoke:agent-enrollment
```

### 4. Rerun Deployment Contract Checks

Always rerun the base contract check before escalating:

```powershell
npm run check:contract -- --base-url http://localhost:3000
```

If `health`, `public_key`, or `enrollment_readiness` fails, treat the incident as deployment readiness until proven otherwise. Recheck `DATABASE_URL`, signing env, migration status, and server logs.

If the contract check and provider smoke both pass but the downstream client still fails on the same payload, gather the downstream command output or HTTP request/response and debug the client-side enrollment, digest, and signing path.

Full diagnosis tables: [passport-enrollment-ops.md#diagnosis](./passport-enrollment-ops.md#diagnosis).

---

## Live evidence to capture per submission

For each downstream receipt or audit packet submission during a live pilot, capture these fields in the operator audit trail:

### From Passport (substrate)

| Field | Source |
|---|---|
| `subject_commitment` | Enrollment `enroll/complete` response; path segment for evidence |
| `event_commitment_hash` | Evidence ingest response |
| `enrollment_status` | Evidence ingest response and/or profile readback |
| `payload_digest` | Re-derived locally: `sourceDigest(payload)` |
| ed25519 `signature` | Client-signed `UTF-8(payload_digest)` |
| `public_key` | Stored at enrollment (64-hex lowercase) |
| `observed_at` | Evidence payload field |
| `source_type` | Evidence request body (e.g. `compliance_report`, `github_push_webhook`) |

### From Passport logs (one line per request)

- `reason_code` (e.g. `not_enrolled`, `validation_error`, `invalid_proof`)
- `http_status`
- `outcome` (`issued`, `rejected`, `error`)

### Downstream-owned (NOT on Passport public profile)

- APF: `completeness`, `gaps`, `agent_artifact_digest`, `agent_event_digest`, packet artifact paths
- Repo Passport: receipt copy, GitHub surface placement, reviewer-facing fields

Do **not** expect Passport public profiles to expose APF `completeness` / `gaps` - contract check enforces this boundary.

---

## Pilot Integration Checklist (Ops Tracking)

Use this checklist as the ops record for onboarding a Repo Passport or APF pilot against Passport:

- [ ] Confirm Passport launch-readiness gate passes (`check:env`, `doctor:passport`, `db:status`, `check:contract`).
- [ ] Set `PASSPORT_BASE_URL` (or `BASE_URL` for provider smoke) to the pilot Passport deployment.
- [ ] Generate or load agent ed25519 keypair; derive `subject_commitment` with context `passport-v1`.
- [ ] Run enrollment: `enroll/start` -> sign challenge -> `enroll/complete`; confirm status `ISSUED`.
- [ ] Persist `subject_commitment`, public key, context, and private-key reference in downstream state.
- [ ] Build evidence payload with correct `source_type` for the pilot (Repo Passport vs `compliance_report` for APF).
- [ ] Compute `payload_digest = sourceDigest(payload)`; sign `UTF-8(payload_digest)`.
- [ ] Submit `POST .../agents/:subject_commitment/evidence`; confirm HTTP 201 and `enrollment_status: "ENROLLED"`.
- [ ] Store `event_commitment_hash` and `enrollment_status` on the downstream receipt/packet record.
- [ ] Verify readback: `GET /api/v1/profiles/:subject_commitment` returns `ENROLLED`.
- [ ] Run post-enrollment contract check with `--subject-commitment` and `--expect-enrollment-status ENROLLED`.
- [ ] Capture live evidence fields (table above) plus matching Passport log line for each submission.
- [ ] If evidence returns 403, confirm enrollment completed before evidence - check logs for `reason_code: "not_enrolled"`.

Reference implementations: `3 aaamigas` demos and [passport-client-reference.md](../../3%20aaamigas/docs/passport-client-reference.md).

---

## Rate limits and multi-instance caveats

Enrollment and evidence routes use an **in-memory per-IP rate limiter** (default 30 req / 60s). There is no shared Redis store - behind multiple replicas, effective throughput scales roughly with instance count.

| Variable | Default |
|---|---|
| `ENROLLMENT_RATE_LIMIT_MAX` | `30` |
| `ENROLLMENT_RATE_LIMIT_WINDOW_MS` | `60000` |

`EVIDENCE_ENFORCEMENT_ENABLED` defaults to `false` - credits are not enforced until explicitly enabled.

---

## Daily maintenance

For scheduled docs-first micro-wins (health check, audit backlog, one safe change per day), use the copy-paste agent prompt in [daily-maintenance-loop.md](./daily-maintenance-loop.md).

---

## Escalation boundaries

Do **not** change Passport protocol, schema, routes, signing, or receipt format for pilot support unless a concrete blocker is found and approved at founder level. Surface blockers with:

- Failing contract-check output
- Relevant JSON log lines
- HTTP status + error body from the failing request
- Steps to reproduce from smoke or demo scripts

See [audit-packet-factory-integration.md#intentional-boundaries](./audit-packet-factory-integration.md#intentional-boundaries) for APF-specific non-goals.
