# Passport — External Security & Resilience Audit Scope

**Product:** Passport — tamper-evident behavioral receipt system for AI agents
**Live URL:** https://passport.metis.gold
**Deployment:** Next.js 16 standalone on Render, PostgreSQL, Cloudflare CDN
**Source:** https://github.com/AngelBoyGo/passport (private — share access on request)
**Version:** Commit `4d33183` (main branch, `main`)
**Test suite:** 610 tests, 89 files, all passing
**Evidence ingestion:** ✅ Verified working end-to-end on production

---

## 1. Executive summary

Passport is a trust substrate that issues Ed25519-signed, tamper-evident behavioral receipts for AI agent work. The surface area includes:

- **Operators** authenticate via email/password or OAuth (GitHub, Google), receive bearer API keys (`pp_`), and manage agents, receipts, and subscriptions from an executive admin dashboard.
- **Agent enrollment** uses Ed25519 challenge-response: the agent generates a keypair, proves possession by signing a nonce, and receives a permanent identity commitment (SHA-256 of public key + context `passport-v1`).
- **Evidence ingestion** accepts six source types (GitHub push/commit/issue, OTel GenAI traces, compliance reports, task deliverables) with per-type Zod schemas, normalizes into event types, and persists with privacy-preserving salted SHA-256 commitments.
- **Receipt issuance** creates Ed25519-signed receipts with canonical JSON hashing. Finalize appends outcomes (success/refusal/null/terminal) with optional domain blinding and chain linking. Anyone can verify offline against the published public key without trusting the server.
- **AngelCoin ledger** is an append-only journal with transferable credits, access tiers, and escrow-based engagement lifecycle.
- **Gate pass** evaluates operator eligibility per domain using sliding-window SLA breach thresholds and minimum escrow bond.

All code is TypeScript with full Prisma/PostgreSQL migration history.

---

## 2. Accounts

Supply real credentials before handoff:

| Role | How to create | What to test |
|---|---|---|
| Executive Admin | Sign up at `https://passport.metis.gold/signup`, set `ADMIN_OPERATOR_EMAILS` in Render env | Full dashboard, API keys, all routes |
| Regular Operator | Sign up at `/signup` (email not in admin allowlist) | Scoped dashboard (own receipts, credits), limited routes |
| Enrolled Agent | Complete `/enroll/start` + `/enroll/complete` with Ed25519 keypair | Evidence ingestion, profile view |
| Unenrolled Agent | Fresh Ed25519 keypair, not enrolled | Enrollment only (challenge-response flow) |

A test agent with evidence was enrolled live during pre-audit:

```json
{
  "commitment": "87cfa2bfe15782572d40b0669d83504be9409b0475c91db646ec694f279ca2f6",
  "profile": "https://passport.metis.gold/profiles/87cfa2bfe15782572d40b0669d83504be9409b0475c91db646ec694f279ca2f6"
}
```

---

## 3. Fixed vulnerabilities (do not re-report)

The following were found and remediated before this handoff. Auditors should verify they hold and not re-report:

| # | Finding | Fix | File(s) | Test coverage |
|---|---|---|---|---|
| F1 | Session cookie dropped behind proxy (secure flag from `NODE_ENV` not `x-forwarded-proto`) | `secure` flag now detected from `x-forwarded-proto` request header, falls back to URL protocol | `cookies.ts` | — |
| F2 | Stale-cookie shadowing caused login loop (browser sends multiple `session_token` cookies, only the first was checked) | `resolveSessionFromTokens()` tries all cookie candidates; only returns null when every candidate fails | `auth-service.ts`, `session/route.ts` | 6 tests |
| F3 | No `Cache-Control: no-store` on session endpoint (Cloudflare or browser could cache a 401 forever) | Added `no-store, max-age=0` to every auth-state response (session, admin overview, login 401) | `session/route.ts`, `admin/overview/route.ts` | 1 test |
| F4 | Admin dashboard returned 403 for regular operators in production | Operator-scoped overview: any authenticated operator receives 200 with their own scoped data, plus `executiveAdmin: true/false` flag | `admin/overview/route.ts` | 4 tests |
| F5 | Password comparison vulnerable to timing attack (used `===` string comparison on SHA-256 hash) | `crypto.timingSafeEqual(Buffer, Buffer)` replaces `===` for password hash verification | `auth-service.ts` | 5 tests |
| F6 | Login/signup endpoints had no input validation (no Zod schemas, raw JSON parse only) | `loginBodySchema` and `signupBodySchema` added with email format and minimum password length validation | `enrollmentSchemas.ts`, `login/route.ts`, `signup/route.ts` | — |
| F7 | Auth endpoints had no per-IP rate limiting (only middleware's generic 100/min) | Login limited to 10/min/IP, signup to 5/min/IP, both return 429 with `X-RateLimit-*` headers via `rateLimitResponse()` | `login/route.ts`, `signup/route.ts`, `rateLimit.ts` | — |
| F8 | `ReceiptPublicManifest` omitted `signature`, making offline Ed25519 verification impossible from the public API | `signature: string | null` added to the manifest response — anyone can now verify offline against the published public key | `portal-service.ts` | 2 tests |
| F9 | Evidence ingestion accepted `payload` as a raw JSON string, causing silent 401 (signature mismatch between client's `sha256(canonicalJson(obj))` and server's `sha256(String(string))`) | Early rejection with explicit error: "payload must be a JSON object, not a raw string" | `evidence-binding.ts` | — |
| F10 | `compliance_report` schema required `report.id` nested under `"report"` — natural top-level `report_id` was rejected | Schema now accepts `report_id` at the top level as a fallback; normalization uses whichever is present | `github-agent-adapter.ts` | 1 test |
| F11 | Public-key response marked `immutable`, misleading verifiers who should rotate | Changed to `Cache-Control: public, max-age=3600` (no `immutable`) — verifiers should refresh after 1 hour | `public-key/route.ts` | — |
| F12 | Signature validation had a single generic error message for all failures | Three distinct messages: "signature is required" / "signature must be exactly 128 hex characters (got N)" / "signature contains non-hexadecimal characters" | `evidence-binding.ts` | — |
| F13 | Evidence route had no body size limit | 1 MB limit enforced via `Content-Length` header check before parsing JSON | `evidence/route.ts` | — |
| F14 | Logout only deleted the single session token in the cookie — other operator sessions remained active | `deleteAllSessionsForOperator()` deletes every session for the operator on logout; also deletes all cookie candidates for stale-cookie cleanup | `auth-service.ts`, `logout/route.ts` | — |
| F15 | Rate-limited 429 responses returned `Retry-After` but not the standard `X-RateLimit-*` headers | `rateLimitResponse()` helper now returns `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` on every 429; applied to gate/verify, login, signup, evidence routes | `rateLimit.ts`, gate/login/signup/evidence routes | — |
| F16 | `NEXT_PUBLIC_*` env vars baked at Docker build time cannot be set at Render runtime | Server-side config routes (`/api/auth/google/config`, `/api/auth/github/config`) read env vars at runtime; login page fetches client IDs via `useEffect` instead of `process.env.NEXT_PUBLIC_*` | `google/config/route.ts`, `github/config/route.ts`, `login/page.tsx` | — |
| F17 | Google OAuth `redirect_uri` used `request.url` which resolves to `0.0.0.0:10000` on Render, causing `redirect_uri_mismatch` with Google | `getBaseUrl()` helper prefers `NEXT_PUBLIC_APP_URL` over request-derived origin; applied to token exchange and redirect calls | `google/route.ts` | — |

**Total:** 17 findings fixed, 22 new tests, 14 files changed, 331 insertions + 43 deletions.

---

## 4. Testing principles

1. **No production-destructive tests** without prior written approval. Use staging where DB drops, env-var removal, and migration fault injection are required.
2. **Every error response** must return uniform `{ "error": "..." }`. No stack traces, internal paths, or PII.
3. **Privacy promises** (hash-only storage, salted commitments, masked domains) must be validated against actual response bodies, not docs.
4. **Verifiability claims** must be independently re-proven: recompute `sha256(canonicalJson(fields))` and verify the Ed25519 signature against the published key offline.
5. **Report format:** Markdown or PDF per finding, with severity (CRITICAL/HIGH/MEDIUM/LOW), reproduction steps (curl preferred), observed vs expected behavior, likely root cause, and source file/line reference.

---

## 5. Technical spec sheet

| Area | Expectation |
|---|---|
| Test environments | Staging preferred; production-safe validation only on read/idempotent endpoints |
| Tooling | curl / HTTPie; Playwright or browser devtools; Burp or mitmproxy; Node.js 20+ for offline Ed25519 verification script |
| Identity material | Executive admin session, regular operator session, enrolled agent key, unenrolled fresh Ed25519 keypair |
| Network conditions | Normal path, forced-cache proxy, concurrent load, expired/replayed cookie, malformed headers |

---

## 6. Endpoint scope

### Section A: Auth & Session (§1–2)
- `POST /api/auth/login` — bruteforce, malformed input, session cookie semantics
- `POST /api/auth/signup` — collision, Unicode normalization, rate limiting
- `GET /api/auth/session` — cookie shadowing, cache headers, expired token replay
- `POST /api/auth/logout` — full invalidation (all operator sessions), cross-tab consistency
- `GET /api/auth/github`, `GET /api/auth/google` — OAuth callback abuse, error paths
- `GET /api/auth/google/config`, `GET /api/auth/github/config` — runtime config endpoints

**Minimum assertions:**
- Zod validation rejects: empty JSON, missing fields, wrong types, Unicode injection, 10KB+ payloads, SQL injection strings in email
- Login rate limits at 10/min/IP with `X-RateLimit-Limit/Remaining/Reset` headers on 429
- `GET /api/auth/session` returns `Cache-Control: no-store` on both 200 and 401
- Two simultaneous `session_token` cookies (stale + fresh) resolve to the valid one
- After logout, all operator sessions are invalidated, not just the current cookie's token

### Section B: Admin Dashboard (§3)
- `GET /api/admin/overview` — operator scoping, degraded dependencies, concurrency
- `/admin` — UI loads without crashing for non-executive operators
- `/admin/api-keys`, `/admin/receipts` — sub-pages

**Minimum assertions:**
- Regular operator gets `200` with `executiveAdmin: false`, scoped to their own receipts and credits
- DB outage returns degraded-health JSON (not 500 or crash)
- Missing `SIGNING_PRIVATE_KEY` reports "degraded" in health component (not crash)
- 50 concurrent requests produce consistent counters without deadlocks

### Section C: Receipt Integrity (§4)
- `GET /api/v1/receipts/:id/public-manifest` — offline verification primitives
- `POST /api/v1/receipts` — issue a receipt (requires API key + gate pass)
- `POST /api/v1/receipts/:id/finalize` — append outcome and re-sign
- `POST /api/v1/receipts/:id/revoke` — revoke an active receipt
- `GET /api/v1/public-key` — published Ed25519 verifying key

**Minimum assertions:**
- `public-manifest` includes `signature`, `commitment_hash`, `previous_hash`, `verification_status`, `masked_fields`
- Offline recomputation: `sha256(canonicalJson(canonicalFields))` must match `commitment_hash`; Ed25519 signature must verify against the key from `/api/v1/public-key`
- Tampered receipt (any bit flipped in a signed field) returns clear integrity error
- Finalize replays idempotently: first wins, second gets `409 "Receipt already finalized"`
- Concurrent revocations: exactly one succeeds, second gets `409`
- `GET /api/v1/public-key` has `Cache-Control: public, max-age=3600` (no `immutable`)

### Section D: Evidence Ingestion (§5)
- `POST /api/v1/passport/agents/:id/evidence` — schema fuzz, size limits, duplicate keys
- All 6 source types: `github_push_webhook`, `github_commit_payload`, `github_issue_event`, `compliance_report`, `otel_genai_trace`, `task_deliverable`

**Minimum assertions:**
- 1 MB body limit enforced (413)
- String payload rejected with: "payload must be a JSON object, not a raw string. See /docs/integrations for exact per-source-type schemas."
- Duplicate JSON keys produce deterministic digest (JavaScript's last-wins behavior, matching client side `JSON.parse` + `canonicalJson`)
- Three distinct signature errors: missing / wrong length / non-hex characters
- Malformed subject commitment hash returns specific 400
- All 6 source types reject non-matching payload shapes with 400, not 500

### Section E: Rate Limiting (§6)
- `POST /api/v1/gate/verify` — threshold, per-IP isolation, response headers
- Evidence ingestion routes — enrollment rate limits
- Auth endpoints — 10/min login, 5/min signup

**Minimum assertions:**
- 31st request per minute to gate/verify returns 429 with `Retry-After` and `X-RateLimit-Limit/Remaining/Reset`
- Two different IPs have independent rate limit buckets (one client's abuse does not throttle another)
- Middleware adds `X-RateLimit-*` headers to every API response

### Section F: CORS & Security Headers (§7)
- All `/api/*` routes — preflight, origin restrictions, security headers
- `next.config.ts` — global security headers on all routes

**Minimum assertions:**
- OPTIONS responses return correct `Access-Control-Allow-Origin` per route class (public, admin, webhook)
- Admin endpoints block non-`passport.metis.gold` origins in production (403)
- Every response includes: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security: max-age=63072000`
- `Vary: Origin` present on CORS-enabled responses

### Section G: Public Data Leakage (§8)
- `GET /api/v1/profiles/:hash` — masked agent profile
- `GET /api/v1/leaderboard` — truncated commitments, aggregate rates
- `GET /api/v1/receipts/:id/public-manifest` — receipt field masking

**Minimum assertions:**
- Profiles never return: plaintext agent identity, repository names, session log URLs, email addresses, GitHub handles
- All PII fields are either absent or salted SHA-256 commitments
- Leaderboard exposes only `agent_commitment_hash` (full 64-hex), `public_footprint_identifier` (first 12 hex), and aggregate rates — no raw identity
- Public manifest masks: `input_digest`, `output_hash`, `refusal_reason`, `terminal_reason`, `operator_id`, `agent_id`, `authority_scope`, `domain`, `domain_commitment`, `blind_salt`

### Section H: API Key Management (§9)
- `GET /api/v1/operator/api-keys` — list all keys
- `POST /api/v1/operator/api-keys` — create new key (one-shot raw key)
- `DELETE /api/v1/operator/api-keys/:keyHash` — revoke key

**Minimum assertions:**
- Raw key (`pp_<64-hex>`) shown exactly once on creation POST (status 201), never again
- List GET returns `{ id, keyHash, name, createdAt }` — no raw key, no partial key prefix
- `keyHash` cannot be used as a bearer token (lookup re-hashes the input, so the hash itself produces a different hash)
- Deleted key immediately returns 401 on next use
- 100 keys for one operator all listed correctly

---

## 7. Recommended additional checks

1. **Canonical JSON spec match** — the `/docs/api-reference` page documents the canonical field set and key sort order. Verify it matches `canonicalJson()` in `canonical.ts` byte-for-byte: sorted keys, compact separators `(,)` and `(:)`, undefined/absent fields omitted entirely (not `null`).

2. **Error envelope consistency** — every 4xx/5xx across all routes returns `{ "error": string }` uniformly. Some Zod validation paths return `{ "error": "Validation failed", "issues": {...} }` — verify this doesn't leak internal field names.

3. **API key list ID field** — `id` is a Prisma CUID; verify it doesn't leak key creation count or sequential ordering.

4. **Blinded domain timing** — `verifyGatePass` iterates receipts and computes `computeDomainCommitment(domain, salt)` in a loop. Verify this doesn't leak which domains exist via timing.

5. **Webhook oversized body** — the Stripe webhook endpoint (`/api/stripe/webhook`) reads the raw body for signature verification. Verify a body size limit is enforced.

6. **CDN/edge behavior** — verify `Vary`, `Cache-Control`, and Cloudflare cache indicators (`cf-cache-status`) on session, admin, and manifest endpoints under forced-cache-proxy conditions.

---

## 8. Pass criteria

- [ ] Zero crash/panic/HTML exception under any input shape
- [ ] Uniform JSON error body `{ "error": "..." }` on all 4xx/5xx — no stack traces, no internal paths, no HTML
- [ ] No PII leakage in any public response where masking/hash-only is promised
- [ ] Rate limits enforced, bounded, and per-IP isolated
- [ ] Ed25519 signature verification is deterministic and repeatable offline with only the public manifest + published key
- [ ] Stale cookie shadowing resolved: two `session_token` cookies where the first is expired/garbage and the second is valid → the valid one wins
- [ ] Operator-scoped overview returns 200 for all operators and includes `executiveAdmin: true/false`
- [ ] Offline receipt verification using `public-manifest` + `public-key` produces the same result as server-side `verification_status`
- [ ] Evidence ingestion rejects string payloads with the correct error message
- [ ] Login/signup rate limited per IP with `X-RateLimit-*` headers
- [ ] Session and auth responses never cached (confirmed under forced-cache proxy, on both 200 and 401)

---

## 9. Execution sequence

| Phase | Activities | Destructive? |
|---|---|---|
| 1 | Passive enumeration — inspect headers, cookies, public route shapes | No |
| 2 | Auth/session monkey — malformed inputs, replay, cookie shadowing, rate limits | No |
| 3 | Admin dashboard — operator scoping, concurrency, degraded deps | No |
| 4 | Receipt verification — offline recomputation, tamper, replay, revocation race | No |
| 5 | Evidence fuzz — all 6 source types, size limits, duplicate keys, signature shapes | No |
| 6 | Gate/rate limit — 429 verification, per-IP isolation | No |
| 7 | CORS/headers — preflight, origin blocks, security header presence | No |
| 8 | Data leakage — profile, leaderboard, manifest body review | No |
| 9 | API key management — create/list/revoke lifecycle | No |
| 10 | Destructive tests (staging only) — DB outage, missing migrations, env-var removal | Staging only |

---

## 10. Reporting template

```
Severity: HIGH
Title: Old session cookie accepted after logout
Endpoint: GET /api/auth/session
Environment: staging
Steps:
1. Login as operator and capture session cookie
2. Logout using same browser session
3. Replay captured cookie with curl
Observed: 200 authenticated session returned
Expected: 401 with uniform `{"error":"..."}` JSON
Evidence: [request/response headers + body attached]
Likely area: session validation or logout invalidation path
```

---

## 11. Quick reference: key endpoints and their auth

| Endpoint | Auth | Rate limited | Cache Control |
|---|---|---|---|
| `GET /api/health` | None | No | — |
| `GET /api/v1/public-key` | None | No | `public, max-age=3600` |
| `POST /api/auth/login` | None (email+password) | 10/min/IP | — |
| `POST /api/auth/signup` | None (email+password) | 5/min/IP | — |
| `GET /api/auth/session` | Cookie | No | `no-store, max-age=0` |
| `POST /api/auth/logout` | Cookie | No | — |
| `GET /api/admin/overview` | Cookie | No | `no-store, max-age=0` |
| `POST /api/v1/gate/verify` | None (public) | 30/min/IP | — |
| `GET /api/v1/profiles/:hash` | None (public) | 30/min/IP | — |
| `GET /api/v1/leaderboard` | None (public) | 30/min/IP | — |
| `GET /api/v1/receipts/:id/public-manifest` | None (public) | 30/min/IP | — |
| `POST /api/v1/passport/agents/:id/evidence` | Enrolled agent signature | 30/min/IP | — |
| `POST /api/v1/receipts` | `Authorization: Bearer pp_...` | No | — |
| `GET /api/v1/operator/api-keys` | `Authorization: Bearer pp_...` | No | — |

---

*Prepared 2026-08-16. 17 findings fixed internally. 610 tests passing. Evidence ingestion verified end-to-end on production.*