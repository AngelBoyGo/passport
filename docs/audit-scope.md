# Passport — External Security & Resilience Audit Scope

**Product:** Passport — tamper-evident behavioral receipt system for AI agents
**Live URL:** https://passport.metis.gold
**Deployment:** Next.js 16 standalone on Railway / Render, PostgreSQL, Cloudflare CDN
**Source:** https://github.com/AngelBoyGo/passport (private — share access on request)
**Version:** Commit `adaf5ed` (main branch, pushed)

## 1. Executive summary for the audit firm

Passport is a trust substrate that issues Ed25519-signed, tamper-evident behavioral receipts for AI agent work. The surface area includes:

- **Operators** authenticate via email/password or OAuth (GitHub, Google), receive bearer API keys (`pp_`), and manage agents, receipts, and subscriptions from an admin dashboard.
- **Agent enrollment** uses Ed25519 challenge-response: the agent generates a keypair, proves possession by signing a nonce, and receives a permanent identity commitment (SHA-256 of public key + context).
- **Evidence ingestion** accepts six source types (GitHub push/commit/issue, OTel GenAI traces, compliance reports, task deliverables) with per-type Zod schemas, normalizes into event types, and persists with privacy-preserving salted SHA-256 commitments.
- **Receipt issuance** creates Ed25519-signed receipts with canonical JSON hashing. Finalize appends outcomes (success/refusal/null/terminal) with optional domain blinding and chain linking. Anyone can verify offline against the published public key.
- **AngelCoin ledger** is an append-only journal with transferable credits, access tiers, and escrow-based engagement lifecycle.
- **Gate pass** evaluates operator eligibility per domain using sliding-window SLA breach thresholds and minimum escrow bond.

All code is TypeScript with 610 automated tests and full Prisma/PostgreSQL migration history.

## 2. Accounts

Supply real credentials before handoff:

| Role | How to create | What to test |
|---|---|---|
| Executive Admin | Sign up at `/signup`, set `ADMIN_OPERATOR_EMAILS` in env | Full dashboard, all routes |
| Regular Operator | Sign up at `/signup` (email not in allowlist) | Scoped dashboard, limited routes |
| Enrolled Agent | Complete `/enroll/start` + `/enroll/complete` with Ed25519 keypair | Evidence ingestion, profile view |
| Unenrolled Agent | Fresh Ed25519 keypair, not enrolled | Enrollment only |

## 3. Critical findings from internal audit (already fixed)

The following were found and remediated before this handoff. Auditors should verify they hold and not re-report:

| Finding | Fix | File(s) |
|---|---|---|
| Session cookie drop behind proxy | `secure` flag now detected from `x-forwarded-proto` | `cookies.ts` |
| Stale-cookie shadowing (login loop) | `resolveSessionFromTokens()` tries all cookie candidates | `auth-service.ts` |
| No `Cache-Control: no-store` on session endpoint | Added `no-store` headers to session/admin routes | `session/route.ts`, `admin/overview/route.ts` |
| Admin dashboard 403 for non-executive operators | Operator-scoped overview with `executiveAdmin` flag | `admin/overview/route.ts` |
| Password comparison timing leak | `crypto.timingSafeEqual` replaces `===` | `auth-service.ts` |
| No Zod validation on login/signup | `loginBodySchema`, `signupBodySchema` added | `enrollmentSchemas.ts`, login/signup routes |
| Auth endpoint bruteforce | 10/min login, 5/min signup rate limits | `login/route.ts`, `signup/route.ts` |
| Missing `signature` in public manifest | `signature` field added to `ReceiptPublicManifest` | `portal-service.ts` |
| String payload accepted silently | Early rejection with clear error message | `evidence-binding.ts` |
| `compliance_report` required nested `report.id` | Top-level `report_id` now accepted | `github-agent-adapter.ts` |
| Public-key marked `immutable` | Changed to `max-age=3600` | `public-key/route.ts` |
| Generic signature validation error | Specific errors for length vs hex content | `evidence-binding.ts` |
| Missing body size limit on evidence | 1 MB limit enforced via Content-Length | `evidence/route.ts` |
| Session route not fully invalidating logout | `deleteAllSessionsForOperator()` | `auth-service.ts`, `logout/route.ts` |
| Rate-limit 429 responses missing `X-RateLimit-*` headers | `rateLimitResponse()` helper applied to key routes | `rateLimit.ts`, gate/login/signup/evidence routes |

## 4. Testing principles

1. **No production-destructive tests** without prior written approval. Use staging where DB drops, env-var removal, and migration fault injection are required.
2. **Every error response** must return uniform `{ "error": "..." }`. No stack traces, internal paths, or PII.
3. **Privacy promises** (hash-only storage, salted commitments, masked domains) must be validated against actual response bodies, not docs.
4. **Verifiability claims** must be independently re-proven: recompute `sha256(canonicalJson(fields))` and verify the Ed25519 signature against the published key offline.
5. **Report format:** Markdown or PDF per finding, with severity (CRITICAL/HIGH/MEDIUM/LOW), reproduction steps (curl preferred), observed vs expected behavior, likely root cause, and source file/line reference.

## 5. Technical spec sheet

| Area | Expectation |
|---|---|
| Test environments | Staging preferred; production-safe validation only on read/idempotent endpoints |
| Tooling | curl / HTTPie; Playwright or browser devtools; Burp or mitmproxy; small offline verifier for SHA-256 + Ed25519 |
| Identity material | Executive admin session, regular operator session, enrolled agent key, unenrolled fresh Ed25519 keypair |
| Network conditions | Normal path, forced-cache proxy, concurrent load, expired/replayed cookie, malformed headers |

## 6. Endpoint scope

### Section A: Auth & Session (§1–2 of monkey test)
- `POST /api/auth/login` — bruteforce, malformed input, session cookie semantics
- `POST /api/auth/signup` — collision, normalization, rate limiting
- `GET /api/auth/session` — cookie shadowing, cache headers, expired token replay
- `POST /api/auth/logout` — full invalidation, cross-tab consistency
- `GET /api/auth/github`, `GET /api/auth/google` — OAuth callback abuse, error paths

**Minimum assertions:**
- Zod validation rejects: empty JSON, missing fields, wrong types, Unicode injection, 10KB+ payloads, SQL injection strings
- Login rate limits at 10/min/IP with `X-RateLimit-*` headers on 429
- `GET /api/auth/session` returns `Cache-Control: no-store` on both 200 and 401
- Two simultaneous `session_token` cookies (stale + fresh) resolve the valid one
- After logout, all operator sessions are invalidated (not just the current token)

### Section B: Admin Dashboard (§3 of monkey test)
- `GET /api/admin/overview` — operator scoping, degraded dependencies, concurrency

**Minimum assertions:**
- Regular operator gets 200 with `executiveAdmin: false`, scoped to their data
- DB outage returns degraded-health JSON (not 500)
- Missing `SIGNING_PRIVATE_KEY` reports degraded (not crash)
- 50 concurrent requests produce consistent counters without deadlocks
- Missing `Session` table returns clear error (not raw 500)

### Section C: Receipt Integrity (§4 of monkey test)
- `GET /api/v1/receipts/:id/public-manifest` — offline verification primitives
- `POST /api/v1/receipts/:id/finalize` — replay, tamper detection
- `POST /api/v1/receipts/:id/revoke` — race condition

**Minimum assertions:**
- `public-manifest` includes `signature`, `commitment_hash`, and `verification_status`
- Offline recomputation: `sha256(canonicalJson(canonicalFields))` matches `commitment_hash`; Ed25519 signature verifies against `/api/v1/public-key`
- Tampered receipt returns clear integrity error (not 500)
- Finalize replay returns 409 "already finalized"
- Concurrent revocations: exactly one wins, second gets 409

### Section D: Evidence Ingestion (§5 of monkey test)
- `POST /api/v1/passport/agents/:id/evidence` — schema fuzz, size limits, duplicate keys

**Minimum assertions:**
- 1 MB body limit enforced (413)
- String payload rejected with specific error: "payload must be a JSON object, not a raw string"
- Duplicate JSON keys produce deterministic digest (last-wins, matching client-side)
- Invalid signature length vs non-hex vs valid: three distinct error messages
- Malformed subject commitment hash returns specific 400
- All 6 source types reject non-matching payload shapes with 400, not 500

### Section E: Rate Limiting (§6 of monkey test)
- `POST /api/v1/gate/verify` — threshold, isolation, headers
- Evidence ingestion routes — enrollment rate limits

**Minimum assertions:**
- 31st request per minute to gate/verify returns 429 with `Retry-After` and `X-RateLimit-Limit/Remaining/Reset`
- Two different IPs have independent rate limit buckets
- Middleware adds `X-RateLimit-*` headers to all non-429 API responses

### Section F: CORS & Security Headers (§7 of monkey test)
- All `/api/*` routes — preflight, origin restrictions, security headers

**Minimum assertions:**
- OPTIONS responses return correct `Access-Control-Allow-Origin` per route class
- Admin endpoints block non-`passport.metis.gold` origins in production
- Every response includes: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security`
- `GET /api/v1/public-key` has `Cache-Control: public, max-age=3600` (no `immutable`)
- `Vary: Origin` present on CORS-enabled responses

### Section G: Public Data Leakage (§8 of monkey test)
- `GET /api/v1/profiles/:hash` — privacy masking
- `GET /api/v1/leaderboard` — truncated commitments
- `GET /api/v1/receipts/:id/public-manifest` — field masking

**Minimum assertions:**
- Profiles never return plaintext agent identity, repository names, or session logs
- Leaderboard exposes only truncated commitments (first 12 hex) and aggregate rates
- Public manifest masks: `input_digest`, `output_hash`, `operator_id`, `agent_id`, `authority_scope`, `domain`, `domain_commitment`, `blind_salt`

### Section H: API Key Management (§9 of monkey test)
- `GET /api/v1/operator/api-keys` — list
- `POST /api/v1/operator/api-keys` — create (one-shot raw key)
- `DELETE /api/v1/operator/api-keys/:keyHash` — revoke

**Minimum assertions:**
- Raw key shown exactly once (on creation `POST` response)
- Raw key never returned by list `GET` or any other endpoint
- List endpoint shows `keyHash` (SHA-256), name, createdAt — no raw key, no partial key prefix
- Deleted key immediately returns 401 on next use
- 100 keys for one operator all listed correctly

## 7. Recommended additional checks

These are not in the main scope but add coverage:

1. **Canonical JSON spec match** — verify the documented canonicalization in `/docs/api-reference` matches the server's `canonicalJson()` function byte-for-byte.
2. **Error envelope consistency** — every 4xx/5xx across all routes returns `{ "error": string }` — no Zod `flatten()` shapes, no framework HTML, no stack traces.
3. **API key list metadata** — verify `id` field doesn't leak key count or sequential IDs.
4. **Blinded domain timing** — verify gate pass domain matching uses constant-time comparison (not short-circuit on first match).
5. **Webhook oversized body** — verify Stripe webhook endpoint enforces a body size limit.
6. **CDN behavior** — verify `Vary`, `Cache-Control`, and Cloudflare cache indicators on session, admin, and manifest endpoints under forced-cache-proxy conditions.

## 8. Pass criteria

- [ ] Zero crash/panic/HTML exception under any input shape
- [ ] Uniform JSON error body `{ "error": "..." }` on all 4xx/5xx
- [ ] No PII leakage in any public response where masking/hash-only is promised
- [ ] Rate limits enforced, bounded, and per-IP isolated
- [ ] Ed25519 signature verification is deterministic and repeatable offline
- [ ] Stale cookie shadowing resolved (two `session_token` cookies, valid one wins)
- [ ] Operator-scoped overview returns 200 for all operators with `executiveAdmin` flag
- [ ] Offline receipt verification using `public-manifest` + published public key produces the same result as server-side `verification_status`
- [ ] Evidence ingestion rejects string payloads correctly
- [ ] Login/signup rate limited per IP with all required headers
- [ ] Session and auth responses never cached (confirmed under forced-cache proxy)

## 9. Execution sequence

1. Passive enumeration — headers, cookies, public route shapes
2. Auth/session monkey — malformed inputs, replay, shadowing, rate limits
3. Admin dashboard — operator scoping, concurrency, degraded deps
4. Receipt verification — offline recomputation, tamper, replay, revocation race
5. Evidence fuzz — all 6 source types, size limits, duplicate keys, signature shapes
6. Gate/rate limit — 429 verification, per-IP isolation
7. CORS/headers — preflight, origin blocks, security headers
8. Data leakage — profile, leaderboard, manifest body review
9. API key management — create/list/revoke lifecycle
10. Destructive tests (staging only) — DB outage, missing migrations, env-var removal

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
Evidence: [request/response attached]
Likely area: session validation or logout invalidation path
```

## Appendix: Fixed vulnerabilities summary for auditor reference

The internal audit resolved 17 findings across 6 categories. A summary CSV is available at `audit/fixed-findings-2026-08-16.csv` in the repository. Key remediations:

| Category | Fixes applied | Test coverage |
|---|---|---|
| Auth/session | 6 (timing-safe password, Zod schemas, rate limits, cookie shadowing, no-store headers, full logout) | 12 new tests |
| Admin dashboard | 2 (operator scoping, degraded DB handling) | 4 new tests |
| Receipt crypto | 1 (signature in public manifest) | 2 new tests |
| Evidence fuzz | 4 (size limit, string rejection, signature errors, compliance_report schema) | 3 new tests |
| Rate limiting | 2 (header completeness, auth rate limits) | existing + verification |
| Public key | 1 (removed `immutable`) | existing test |

Total: 14 files changed, 331 insertions, 43 deletions across the 610-test suite.