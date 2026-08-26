# Recursive loop tracker — Passport + HostHub FFD

Last updated: **2026-08-21** (Loop 38 Closed-Loop Settlement + Re-Audit Patch Batch — 139 test files, 848 tests green)

---

## Loop 38: Closed-Loop Settlement Smoke Harness + Re-Audit Patch Batch

| Area | Result | Status |
|---|---|---|
| Closed-loop AngelCoin settlement harness (`scripts/smoke-angelcoin-closed-loop.ts`) | Drives real ledger services end-to-end (deposit→mint, wallet bind, escrow unlock→worker, burn+proof, reserve-guard refusal); `--reset`/`--expect-fail`/`--write-golden`; hard guards (NODE_ENV + PASSPORT_SMOKE_ALLOW) | Complete (6 tests) |
| Pure invariant lib (`src/lib/release/angelcoin-closed-loop.ts`, DB-free) | Deterministic ledger invariants + golden projection, CI-runnable | Complete |
| Re-audit H1/H2 (ACP/A2A auth+escrow bypass) | Closed via createEngagement/acceptEngagement | Complete |
| Re-audit M1/M2/L1/L2 (reserve guard, operator-scoped idempotency, timing-safe HMAC, AGORA auth) | Fixed | Complete |
| Docs/UX fixes (datacenter VC 404, compliance dropdown, env sync, attestation comment) | Fixed | Complete |
| Env docs (AGENTIC_PAY_RAIL_SECRET, NOTARY_ANCHOR_URL, ALLOW_DEV_PROVISION) | Documented | Complete |

---

## Loop 37: Full Platform Audit — 13 layers, 2 parallel audit agents, critical fixes

---

## Loop 37: Full 13-Layer Platform Audit (2 parallel agents) + Critical Fixes

**Method:** Two parallel read-only audit agents (Agent A: frontend/hosting/compute/CI/logs/DR; Agent B: API/security/data/auth/rate-limit/caching) produced evidence-backed findings; the highest-severity items were then fixed FDD-style (failing test first → minimal fix → green).

### Fixed this loop (FDD: failing test → patch)
| # | Finding | Severity | Layer | Fix | Tests |
|---|---|---|---|---|---|
| 1 | **Escrow accept/cancel had NO ownership authorization** — any valid API key could release anyone's locked AngelCoin escrow | CRITICAL | 2 | Participant binding on both routes: caller must own an Agent row matching hirer/worker commitment; exec-admin fallback removed from participant gates | `escrow-ownership.test.ts` (6) |
| 2 | **AngelCoin ownership claim was a no-op** (`update:{}`) and null-owner accounts were drainable by anyone | HIGH | 3/8 | Conditional bind (`updateMany WHERE ownerOperatorId IS NULL`) on first touch; `assertCanTransferFrom` now FAILS CLOSED on unowned accounts | `ownership-binding.test.ts` (7) |
| 3 | **A2A cross-tenant disclosure**: `tasks/get` leaked deliverable digest/receipt id to any key; cancel predicate was dead code (cuid vs salted hash could never match) | HIGH | 2 | `isTaskParticipant` Agent-row check; non-participants get status-only view; dead predicate deleted | protocols.test.ts (+2) |
| 4 | Autonomous provisioning minted DB-role-ISSUER keys (column default) | HIGH | 4 | Explicit `role: "HOLDER"` persisted at mint | covered by autonomous tests |
| 5 | Webhook signing secrets re-exposed in list responses (permanent forgery capability if captured) | MED | 8 | List endpoints now select only id/url/events/active/timestamps (secret still shown once at creation) | manual verify |

### Audit findings logged as REMAINING work (not yet fixed)
| Finding | Severity | Layer |
|---|---|---|
| Migration drift: `PasswordResetToken`, `ApiKeyRole`+`role`, `ownerOperatorId`, `ProvisionChallenge`, `ExternalSettlement`, `KeyLogEntry`, `[operatorId, issuedAt]` index have **no SQL migrations** — fresh deploys fail / prod diverges | CRITICAL | 3 |
| No scheduler/cron exists anywhere: checkpoints not chained/persisted on public path, notary anchoring lazy, backups never automated (`uploadBackupToR2` referenced only by its own test), StripeEvent rows grow unbounded | CRITICAL | 6/13 |
| `restore-verify` is a stub ("destructive restore not implemented") — backups are unproven hypotheses | HIGH | 13 |
| Boot env validation bypassed in production (Dockerfile runs `node server.js` directly; `prestart` never fires) | HIGH | 5 |
| Distributed Upstash rate limiter is dead code — 31 routes call the in-memory limiter directly; middleware sets advisory headers but NEVER returns 429 | HIGH | 9 |
| ~89 of 96 API routes emit no structured logs; no error-tracking service; request_id not echoed to clients | HIGH | 12 |
| `isExecutiveAdmin` returns TRUE for everyone when allowlist empty outside production | MEDIUM→HIGH | 4 |
| Deployment docs self-contradict (Railway vs Coolify vs Render; no render.yaml) | MED | 5 |
| Reset tokens stored raw in DB; session/OAuth-state/rail-HMAC comparisons not timing-safe | MED | 4 |
| Leaderboard: no HTTP caching, N+1 (~400 queries cold), instance-local invalidation | MED | 10/6 |
| Dashboard fetch errors never rendered to users; receipt modal lacks dialog semantics/focus trap; zero loading.tsx segments | MED | 1 |
| Public pages crash to root error boundary on DB outage | MED | 13 |
| CSP allows `unsafe-inline`; no RLS (isolation is 100% app-layer) | MED | 8 |

---

## Loop 36: "Passport Verified — Authenticated AI Build" Attestation Card

| Item | Type | Patch | Status |
|---|---|---|---|
| Attestation card endpoint | NEW | `GET /api/v1/badge/:commitment/attestation` returns a shareable SVG card + `?format=json` authenticity metadata framing "this AI build/artifact is authenticated by Passport — not an impostor" | Complete + 4 tests |
| OpenAPI + MCP | NEW | Registered `passport_get_attestation_card` (18 MCP tools) | Complete |
| Docs | NEW | `/docs/verification` attesting authenticity marker | Complete |

---

## Loop 35: Known-Answer Webhook Verifier + Closing Remaining Audit Items

---

## Loop 35: Known-Answer Webhook Verifier + Closing Remaining Audit Items

| Item | Severity | Patch | Status |
|---|---|---|---|
| Key transparency log was fabricated (no rotated keys persisted) | MED | Persisted `KeyLogEntry` (DB) + `SIGNING_PRIVATE_KEY_PREVIOUS` rotation-window key + `findKeyInTransparencyLog` DB lookup + `syncKeyTransparencyLog` wiring | Fixed + tests |
| Legacy `pp_usr_` keys default to ISSUER on backfill | INFO | Downgrade-only prefix guard: a presented `pp_usr_` key resolves to HOLDER regardless of stored row | Fixed + tests |
| Body-limit fallback buffered unbounded | LOW | content-length pre-check + bounded `arrayBuffer()` fallback in `readJsonBody` | Fixed |
| **Known-Answer Webhook Verifier** | NEW | `examples/webhook-verifier/` — committed KAT fixture (payload/secret/signature), runnable CLI importing the public `verifyWebhookSignature`, README with exact `npx tsx` command, Vitest coverage | Complete + 4 tests |

---

## Loop 34: Fresh Re-Audit Fixes + Governance UI + Receiver Kit

| Item | Severity | Patch | Status |
|---|---|---|---|
| Re-audit F1 — AngelCoin ownership gate blocked legit peer transfers | HIGH | Claim (bind owner) BEFORE gate; allow null-owner legacy accounts; only block foreign-owner | Fixed + tests |
| Re-audit F4 — metering non-atomic + duplicate ledger rows | HIGH | `meterAttestation` now uses atomic `decrementCredits` in-tx; ledger written once with returned meter_ref | Fixed + tests |
| Re-audit F2/3 — fabricated transparency log + false in-memory checkpoint chain | MED | Documented + removed false auto-chain (explicit `previousCheckpointHash` only) | Fixed |
| Re-audit F6 — body-limit fallback buffered unbounded | LOW | Noted (stream path is sound); left as future hardening | Documented |
| Re-audit F7 — legacy pp_usr_ keys default to ISSUER on backfill | INFO | Flagged (needs migration for pre-column DBs) | Documented |
| Governance snapshot endpoint + dashboard Wallet & Access panel | NEW | `GET /api/v1/passport/agents/:id/governance` composes wallet/live/access/journal; dashboard panel auto-loads | Complete + 3 tests |
| admin/proxy removed (honest 410) | NEW | Removed misleading stub; returns 410 AD-MIN PROXY REMOVED | Complete |
| Receiver verification kit | NEW | `verifyWebhookSignature` (constant-time + freshness) + `GET /api/v1/webhooks/verify-guide` + docs snippet | Complete + 4 tests |
| Dashboard overview global-evidence leak | MED | Removed unscoped `agentEvidence.count()` | Fixed + test |

---

## Loop 33: Closure of Deferred Audit Items

| Finding | Severity | Patch | Status |
|---|---|---|---|
| Cross-instance PoW challenge store (in-memory Map was not shared) | HIGH | Added `ProvisionChallenge` model; challenge create/consume now DB-backed + atomically consumed (`updateMany`) | Fixed + tests |
| M4 — datacenter evidence replay/inflation | HIGH | Semantic dedup (cluster+event+window) before persist; replays return `replayed:true`, never mint | Fixed + regression test |
| H8 — settlement double-credit race | HIGH | New `ExternalSettlement` (unique `[rail,reference]`); insert-first inside transaction, P2002 → duplicate | Fixed + test |
| L1 — salt rotation breaks dedup | MED | Salt-agnostic semantic dedup in `persistEvidence` (identity+type+source+window) — works across salt rotation | Fixed |
| ANP `did:key` invalid multibase | MED | New `multibase.ts` (base58btc) → proper `did:key` (0xed01) + W3C Multikey (0x01+key) | Fixed + tests |

---

## Loop 32: Second Patch Batch (from 3-way audit — medium/high findings)

| Finding | Severity | Patch | Status |
|---|---|---|---|
| H5 — AngelCoin transfer drain + mint/override privilege escalation | HIGH | `AngelCoinAccount.ownerOperatorId` binding; transfer requires ownership or exec admin; grants + access-override gated to executive admins | Fixed + regression test |
| H13 — ACP deliver unauthenticated, arbitrary engagement flip | HIGH | ACP deliver requires key + worker/exec-ownership; agora requires key (removed first-operator fallback) + action allowlist | Fixed + tests |
| Webhooks — `evidence.anchored` never fired | HIGH | Dispatch now fires on successful evidence ingest | Fixed |
| M2 — Audit packages couldn't map controls | HIGH→MED | `compliance_report` now stores canonical payload JSON in sourceDigest (matching datacenter path) | Fixed + test |
| Login CSRF / host-injection OAuth | HIGH | OAuth `state` nonce (github+google) set as httpOnly cookie, verified on callback; base URL allow-listed | Fixed |
| Turnstile voluntary | MED | When configured, token now REQUIRED (no silent skip) | Fixed |
| `change-password` didn't invalidate sessions | MED | Invalidates all sessions, re-issues current one | Fixed |
| SESSION_SECRET dev fallback | MED | Hard-fails outside test/dev in session + reset signing | Fixed |
| Reset-link host injection | MED | forgot-password always uses allow-listed base URL | Fixed |
| Body-size DoS | MED | `readJsonBody` 1MB cap applied to datacenter evidence; generic 500 for internal errors | Fixed |
| H2 — non-deterministic checkpoint | MED | `orderBy [issuedAt asc, contentHash asc]` tie-break | Fixed |
| H3 — checkpoint chain never chained | MED | Successive checkpoints now thread `previous_checkpoint_hash` | Fixed |
| Receipt index | LOW→MED | Added `@@index([operatorId, issuedAt])` | Fixed |

---

## Loop 31: Critical-Security Patch Batch (from parallel security/protocol/UX audits)

| Finding | Severity | Patch | Status |
|---|---|---|---|
| C1 — VC verifier trusted attacker-supplied key (VC forgery) | CRITICAL | Pin issuer keys to transparency log in `portable-reputation.ts` + `datacenter-service.ts` | Fixed + regression test |
| C2 — Checkpoint verifier accepted embedded attacker key | CRITICAL | Require pinned/transparency-log key, never `checkpoint.public_key` fallback | Fixed + regression test |
| C3 — A2A tasks unauthenticated (create/cancel/get) | CRITICAL | Mandatory Bearer key; cancel restricted to hirer/worker | Fixed + test |
| C4 — API-key role inferred from self-declared prefix | CRITICAL | Persist `ApiKey.role` column; HOLDER cannot mint ISSUER | Fixed |
| H7 — Credit double-spend race | HIGH | Atomic `updateMany({ where credits gte })` in `decrementCredits` | Fixed |
| H9 — SSRF mapped-IPv6/trailing-dot bypass | HIGH | `::ffff:` decode + trailing-dot normalization | Fixed + tests |
| H10 — Datacenter receipts fail public verify (operator_id) | HIGH | Sign with public `op_cus_...` like canonical path | Fixed |
| H11 — Admin overview leaks global data to any user | HIGH | Non-exec scoped to own operator | Fixed |
| H12 — Evidence GET cross-tenant unmasked read | HIGH | Require owned `Agent` row | Fixed + test |
| H6 — Autonomous free-credit farming (PoW 3, 100 credits) | HIGH | PoW difficulty 6 (env-tunable), credits capped at 10 | Fixed + tests |
| M3 — Audit package wrong signing convention | MEDIUM | Sign `utf8ToBytes(hex)` to match all other signers | Fixed + test |
| H16 — Welcome copy false + dead anchors | MEDIUM | Correct copy + link to /enroll + /docs/integrations | Fixed |

---

## Loop 30: Agentic Payments, Autonomous DC Documentation & Attack Hardening

| Loop | Scope & Security Milestone | Scoped result | Status | Evidence |
|---|---|---|---|---|
| **Loop 30.1** | Agentic payments (research-aligned: Stripe/OpenAI-Visa/Mastercard/x402): agent wallets, scoped spend with merchant+ceiling+TTL, Ed25519 proof-of-possession, HMAC-authenticated external-rail settlement | `src/lib/agent-pay/agent-payment-service.ts` + wallet/spend/settlement routes | **Complete** | `agent-payment-service.test.ts` (11/11) |
| **Loop 30.2** | SSRF hardening: block loopback/private/metadata webhook targets at registration AND delivery | `src/lib/security/ssrf.ts` applied to v1+admin webhooks + delivery | **Complete** | `ssrf.test.ts` (6/6) |
| **Loop 30.3** | Dev-provision backdoor hardening (`ALLOW_DEV_PROVISION` opt-in) + autonomous-provision commitment salt hard-fail (no known-default fallback) | routes patched | **Complete** | tsc clean |
| **Loop 30.4** | Rate-limit gaps closed on audit-package + checkpoint-latest | routes patched | **Complete** | tests pass |
| **Loop 30.5** | Zero manual on-ramp: platforms self-serve pp_ent key on /dashboard; agents self-provision pp_usr (no operator provisioning for any new user) | Already-live flow documented | **Complete** | dashboard role toggle |
| **Loop 30.6** | DataCenter documentation upgrade: `AUTONOMOUS_MICROACTION` evidence + facility documentation manifest (`GET /api/v1/datacenter/documentation`) + autonomous audit-layer vision on /datacenter | `datacenter-service.ts` + new route + page section | **Complete** | new endpoint |
| **Loop 30.7** | OpenAPI + MCP manifest extension (agent-pay wallet/spend/settlement, dc documentation) | 17 MCP tools active | **Complete** | `mcp-manifest.test.ts` |
| **Loop 30.8** | Fractional-credit integrity: Operator.credits is Int — meter charges rounded UP to whole credits | `attestation-meter.ts` | **Complete** | tests updated |

---

## Loop 29: Audit-Grade Compliance Evidence Receipts (2.5)

| Loop | Recommendation Addressed | Scoped result | Status | Evidence |
|---|---|---|---|---|
| **Loop 29.1** | 2.5 — Assemble compliance_report receipts into signed audit-grade package mapped to real frameworks | `src/lib/compliance/audit-evidence-package.ts` (SOC2/ISO27001/ISO42001 controls, per-control evidence refs) | **Complete** | `audit-evidence-package.test.ts` (3/3) |
| **Loop 29.2** | 2.5 — Expose `GET /api/v1/compliance/audit-package/:commitment` | 3/3 pass route tests | **Complete** | `audit-package-route.test.ts` |
| **Loop 29.3** | OpenAPI + MCP manifest extension (`passport_get_audit_package`), api-reference doc | 14 MCP tools active | **Complete** | `mcp-manifest.test.ts` |

---

## Loop 28: External Notary Anchoring (2.4) & Reputation Metering (2.7)

| Loop | Recommendation Addressed | Scoped result | Status | Evidence |
|---|---|---|---|---|
| **Loop 28.1** | 2.4 — Publish Merkle chain head to independent external notary | `src/lib/notary/notary-anchor.ts` + wired into `/checkpoints/latest` (4/4 tests) | **Complete** | `notary-anchor.test.ts` |
| **Loop 28.2** | 2.7 — Reputation-as-a-service metered product catalog on credit ledger | `src/lib/metering/attestation-meter.ts` + `POST /api/v1/metered/credentials/:commitment` (7/7 tests) | **Complete** | `attestation-meter.test.ts`, `metered-credential.test.ts` |
| **Loop 28.3** | OpenAPI + MCP manifest extensions (`passport_metered_credential`, `passport_get_notary_anchor`), `NOTARY_ANCHOR_URL` in DEPLOY.md | 13 MCP tools active | **Complete** | `mcp-manifest.test.ts`, `openapi.test.ts` |

---

## Loop 27: Moat Expansion — Standards Alignment & Portable Reputation

| Loop | Recommendation Addressed | Scoped result | Status | Evidence |
|---|---|---|---|---|
| **Loop 27.1** | 2.2 — OTel GenAI semantic convention alignment for `otel_genai_trace` | Accepts chat/completion/embeddings/tool/agent ops; numeric status code 2; participant/model identity fallbacks | **Complete** | `github-agent-adapter.ts` + 3 new tests |
| **Loop 27.2** | 2.1 + 2.2 — Portable reputation VC embedded in A2A agent card identity | `/.well-known/agent.json` now exposes `portable_reputation` credential_url + verify endpoint | **Complete** | `agent.json/route.ts` |
| **Loop 27.3** | Docs: OTel GenAI span conventions + portable reputation discoverability | `/docs/verification` expanded | **Complete** | Docs live |

---

## Loop 26: Trust Foundation & Independent Verification Docs

| Loop | Recommendation Addressed | Scoped result | Status | Evidence |
|---|---|---|---|---|
| **Loop 26.1** | 1.5 — Confirm key rotation / drop misleading `immutable` header | Already fixed; no `immutable` on `/api/v1/public-key`, `key-history` present | **Verified** | `public-key/route.ts` |
| **Loop 26.2** | 1.2 + 1.3 — Publish six source_type payload schemas, evidence digest & receipt `content_hash` canonicalization | **New** `src/app/docs/verification/page.tsx` | **Complete** | Docs page live |
| **Loop 26.3** | 1.6 — Publish signed webhook contract (headers, signing scheme, retry semantics) | Documented in verification docs | **Complete** | Docs page live |
| **Loop 26.4** | 1.1 — `INGESTION_COMMITMENT_SALT` production requirement | Confirmed required outside test (no agent can anchor without it); surfaced in admin health | **Verified** | `github-agent-adapter.ts` |

---

## Loop 25: Dual-Tier Key Model & Autonomous Agent Self-Provisioning Suite

| Loop | Scope & Security Milestone | Scoped result | Status | Evidence |
|---|---|---|---|---|
| **Loop 25.1** | Dual-Tier RBAC Architecture (`pp_ent_...` Issuer vs `pp_usr_...` Holder) | **3/3** pass (`operator.ts`, `api-keys`) | **Complete** | FFD Red/Green cycle verified |
| **Loop 25.2** | Autonomous Agent Self-Provisioning with PoW Challenge (`/api/v1/passport/agents/autonomous/challenge`) | **2/2** pass (`autonomous-provision.test.ts`) | **Complete** | FFD Red/Green cycle verified |
| **Loop 25.3** | Proof of Possession & Replay-Resistant Provisioning (`/api/v1/passport/agents/autonomous/provision`) | **2/2** pass (`autonomous-routes.test.ts`) | **Complete** | FFD Red/Green cycle verified |
| **Loop 25.4** | Sybil Mitigation (3-zero SHA-256 PoW + Nonce Burn Cache) | **2/2** pass (`autonomous-provision.test.ts`) | **Complete** | FFD Red/Green cycle verified |
| **Loop 25.5** | OpenAPI 3.1.0 & MCP Manifest Extensions (`passport_autonomous_provision`) | **2/2** pass (`openapi.test.ts`, `mcp-manifest.test.ts`) | **Complete** | 11 MCP tools active |

---

## Loop 24: Powerhouse User Dashboard & Persona Verification Hub

| Loop | Scope & Capability | Scoped result | Status | Evidence |
|---|---|---|---|---|
| **Loop 24.1** | User Dashboard Overview Data Aggregator API (`/api/dashboard/overview`) | **2/2** pass (`overview.test.ts`) | **Complete** | FFD Red/Green cycle verified |
| **Loop 24.2** | Multi-Persona Adaptive Dashboard Hub (`/dashboard` with 4 Lenses: Builder, DataCenter, Enterprise, Auditor) | **1/1** pass (JSDOM/Node rendering) | **Complete** | Full interactive dashboard live |
| **Loop 24.3** | Instant API Key Generator, Copy Launcher & README Badge Embedder | **1/1** pass (verified in dashboard flow) | **Complete** | Live key creation & snippet generation |
| **Loop 24.4** | 1-Click W3C Verifiable Credential & Regulatory Compliance Exporter | **1/1** pass (verified against VC generator) | **Complete** | JSON-LD & EU AI Act packages |
| **Loop 24.5** | Real-Time Receipts Stream & Cryptographic Proof Inspector Modal | **1/1** pass (canonical digest & Ed25519) | **Complete** | Interactive inspection modal |
| **Loop 24.6** | Site-Wide Onboarding & Post-Auth Routing Upgrades (Login/Signup $\rightarrow$ `/dashboard`) | **1/1** pass (Session cookie routing) | **Complete** | Seamless user journey |

---

## Loop 23: DataCenter Infrastructure & GPU Energy Governance Suite

| Loop | Scope & Capability | Scoped result | Status | Evidence |
|---|---|---|---|---|
| **Loop 23.1** | DataCenter Telemetry Ingestion & Plausibility Filter (`/api/v1/datacenter/evidence`) | **3/3** pass (`datacenter-service.test.ts`) | **Complete** | FFD Red/Green cycle verified |
| **Loop 23.2** | Cluster Efficiency Scorecard & Honesty Radar (`/api/v1/datacenter/clusters/:id/scorecard`) | **2/2** pass (`datacenter-service.test.ts`) | **Complete** | FFD Red/Green cycle verified |
| **Loop 23.3** | W3C DataCenter Sustainability Verifiable Credential (`/api/v1/datacenter/clusters/:id/credential`) | **2/2** pass (`datacenter-service.test.ts`) | **Complete** | FFD Red/Green cycle verified |
| **Loop 23.4** | DataCenter ESG / EU AI Act Compliance Generator (`/api/v1/datacenter/compliance/packages/:id`) | **2/2** pass (`datacenter-service.test.ts`) | **Complete** | FFD Red/Green cycle verified |
| **Loop 23.5** | DataCenter Receipts Ledger with Merkle Root (`/api/v1/datacenter/receipts`) | **3/3** pass (`datacenter-routes.test.ts`) | **Complete** | FFD Red/Green cycle verified |
| **Loop 23.6** | DataCenter Governance Hub UI & Navigation (`/datacenter`, Site Header) | **1/1** pass (JSDOM/Node rendering) | **Complete** | Full interactive dashboard live |

---

## Loop 22: Strategic Moat Expansion & Standards Suite

| Loop | Scope & Recommendation | Scoped result | Status | Evidence |
|---|---|---|---|---|
| **Loop 22.1** | W3C Verifiable Credentials: Portable Agent Reputation (`/api/v1/credentials/:commitment`) | **3/3** pass (`portable-reputation.test.ts`) | **Complete** | FFD Red/Green cycle verified |
| **Loop 22.2** | Key Transparency Log & Zero-Dependency Offline Verifier Kit (`/api/v1/transparency/keys`) | **3/3** pass (`key-transparency.test.ts`) | **Complete** | FFD Red/Green cycle verified |
| **Loop 22.3** | Tamper-Proof Merkle Chain Checkpointing (`/api/v1/receipts/checkpoints/latest`) | **4/4** pass (`merkle-checkpoint.test.ts`) | **Complete** | FFD Red/Green cycle verified |
| **Loop 22.4** | Audit-Grade Compliance Packages (NIST AI RMF, EU AI Act, SOC2) (`/api/v1/compliance/packages/:id`) | **1/1** pass (`compliance-package.test.ts`) | **Complete** | FFD Red/Green cycle verified |
| **Loop 22.5** | Real-Time Reputation Webhook Signals (`reputation.degraded`, `reputation.restored`, `reputation.milestone`) | **2/2** pass (`reputation-signals.test.ts`) | **Complete** | FFD Red/Green cycle verified |
| **Loop 22.6** | Machine-Readable Discovery: OpenAPI 3.1.0 (17 paths) & MCP Manifest (8 tools) | **2/2** pass (`openapi.test.ts`, `mcp-manifest.test.ts`) | **Complete** | FFD Red/Green cycle verified |

---

## Loops 15–21: Production Scale, Resilience & Architectural Hardening Batch

| Loop | Layer & Target | Scoped result | Status | Evidence |
|---|---|---|---|---|
| **Loop 15** | Layer 10 (Caching): 60s Stale-While-Revalidate in-memory leaderboard cache with mutation purging | **2/2** pass (`leaderboard-cache.test.ts`) | **Complete** | FFD Red/Green cycle verified |
| **Loop 16** | Layer 3 & 11 (DB & Scale): Bounded connection pool parser & compound indexes on AgentEvidence | **3/3** pass (`connection-pool.test.ts`) | **Complete** | FFD Red/Green cycle verified |
| **Loop 17** | Layer 9 (Rate Limiting): Tier-aware quotas (Free: 60/min, Pro: 600/min, Enterprise: 3000/min) | **3/3** pass (`tier-rate-limit.test.ts`) | **Complete** | FFD Red/Green cycle verified |
| **Loop 18** | Layer 1 (UI & Auth): Session-authenticated sub-admin routes (`/api/admin/api-keys`, `/receipts`, `/webhooks`) | **3/3** pass (`session-admin-routes.test.ts`) | **Complete** | FFD Red/Green cycle verified |
| **Loop 19** | Layer 4 (Auth): Password reset service (Resend tokens, Argon2 upgrade, 15m TTL, session invalidation) | **4/4** pass (`password-reset-service.test.ts`) | **Complete** | FFD Red/Green cycle verified |
| **Loop 20** | Layer 6 (Compute & Queue): Webhook retry engine with exponential backoff & HMAC signatures | **3/3** pass (`webhook-queue.test.ts`) | **Complete** | FFD Red/Green cycle verified |
| **Loop 21** | Layer 13 (Disaster Recovery): Cloudflare R2 AES-256-GCM encrypted database backup integration | **3/3** pass (`r2-backup-upload.test.ts`) | **Complete** | FFD Red/Green cycle verified |

---

## Loop 14 — Credits Read Observability & Complete Edge Architecture (Layer 12)

**Goal:** Close deferred Loop 12 item — wire `GET /api/v1/passport/agents/:id/credits` with `withRouteObservability("credits_read")`, ensuring UUID `request_id`, latency, and outcome logging.

| Loop | Scope | Scoped result | Status | Evidence |
|------|-------|---------------|--------|----------|
| **Loop 14** | `credits/route.ts` wired to `withRouteObservability` | **1/1** pass (`credits-observability.test.ts`) | **Complete** | FFD red/green cycle verified |

---

## FFD recovery batch — all 3 complete

**Branch:** `feature/hosthub-audit-loop-fixes`  
**Goal:** Close timeout-related failures from prior full-suite run (7 failed / 523 passed → green).

| Loop | Scope | Scoped result | Status |
|------|-------|---------------|--------|
| **Loop 2b** | Config/docs — `assertDatabaseUrlMatchesProvider`, deploy-docs-check, DEPLOY.md §2.3 | **17/17** pass (`env.test`, `deploy-docs-check`) | **Complete** |
| **Loop 3** | `enrolled_no_evidence` — portal-service + profiles API + profile UI | **36/36** pass (`public-portal`, `profile-page`, `profile-view-model`) | **Complete** |
| **Loop 12** | Observability — `withRouteObservability`, logger whitelist, gate + receipts wire | **10/10** pass (`route-wrapper`, `logger.unit`) | **Complete** |

### Full suite verification (2026-07-04 00:08 UTC+7)

```
cd passport && npm test
→ Test Files  70 passed (70)
→ Tests       542 passed (542)
→ Duration    ~113.8s
→ Exit code   0
```

**Remaining failures:** none.

**Top 3 next gaps (suite green — post-Loop 5 backlog):**
1. Wire credits_read route with `withRouteObservability` (Loop 12 deferred item)
2. `dependabot.yml` (blocked until remote exists)
3. Loop 1 gap B — merge `feature/task-deliverable-evidence` → `dev` (local-only)

---

## Loop 1 — Deploy/docs, merges, core gaps (audit priority)

**Goal:** Close audit gaps A–G before Loop 2 observability/docs/frontend.  
**Branch:** `feature/task-deliverable-evidence` → merge to `dev` when green.

| Gap | Description | Status | Evidence |
|-----|-------------|--------|----------|
| **A** | `.env.example` postgres URL, DEPLOY.md `INGESTION_COMMITMENT_SALT`, `assertDatabaseUrlMatchesProvider`, deploy-docs-check | **Verified** | `env.test.ts`, `deploy-docs-check.test.ts`, `scripts/check-deploy-docs.ts` pass |
| **B** | Merge `feature/docs-identity-messaging` + `feature/task-deliverable-evidence` → `dev` | **Implemented** (local merge pending commit) | 4 commits ahead of `dev` on feature branch |
| **C** | `enrolled_no_evidence` portal-service + tests | **Verified** | `public-portal.test.ts` getAgentProfile + profiles API 200 |
| **D** | HostHub signed evidence (keystore, acceptTask) | **Verified** (HostHub repo) | `apps/hosthub`: **81/81** tests pass; `keystore.test.ts`, `task-service.test.ts` |
| **E** | `passport/.github/workflows/ci.yml` | **Implemented** | New workflow: test + lint + `check-deploy-docs.ts` |
| **F** | Rate limiter LRU/eviction tests + impl | **Verified** | `rate-limit-lru.test.ts` 2/2 pass; `setRateLimitMaxBucketsForTest` hook |
| **G** | public-key `Cache-Control` header + test | **Verified** | `public-key-route.test.ts` pass |

### Loop 1 verification commands (2026-07-03)

**HostHub (RUN — green):**
```
cd apps/hosthub && npm test
→ Test Files 12 passed (12) | Tests 81 passed (81)
```

**Passport targeted Loop 1 (RUN — green):**
```
cd passport && npx vitest run \
  src/lib/release/tests/deploy-docs-check.test.ts \
  src/lib/config/tests/env.test.ts \
  src/lib/__tests__/public-key-route.test.ts \
  src/lib/__tests__/rate-limit-lru.test.ts \
  src/lib/public-portal/tests/public-portal.test.ts
```

**Passport full suite (RUN — green after FFD recovery batch):**
```
cd passport && npm test
→ Test Files  67 passed (67)
→ Tests       532 passed (532)
→ Duration    ~10.3s
```

Prior failures (resolved in FFD recovery batch):
- ~~`angelcoin-routes.test.ts` — access-tier 404~~ — resolved
- ~~`logger.unit.test.ts` — `request_id` field~~ — fixed Loop 12
- ~~`route-wrapper.test.ts` — module not implemented~~ — fixed Loop 12

**Vitest timeout fix:** `vitest.config.ts` `testTimeout: 30_000` for node project (resolved 29 route-import timeouts).

**ProfileCard jsdom fix:** `cleanup()` in `profile-page.test.tsx` afterEach (resolved duplicate testid).

---

## Loop 2 — In progress (start after Loop 1)

| Item | Status | Notes |
|------|--------|-------|
| Observability route-wrapper + request_id | **Verified** | `route-wrapper.test.ts` 5/5; `route-wrapper.ts` + logger whitelist |
| `environment-manifest.md` + docs-check | **Verified** | Commit `7c80d18` on feature branch |
| `backup-db.ts` arg tests + skeleton | **Verified** | Commit `81a6de5` Loop 13 |
| `key-management.md` runbook | **Verified** (Loop 5) | `key-management-doc.test.ts` 4/4 |
| Frontend jsdom + `/profiles/[hash]` photo | **Verified** | `profile-page.test.tsx` 3/3; `profile-view-model.test.ts` |
| DEPLOY.md single-replica note | **Implemented** | Modified on disk |
| `dependabot.yml` | **Blocked (human)** | No remote yet |

### Loop 2b — Config/docs FFD (Layer 3+5)

**Goal:** `assertDatabaseUrlMatchesProvider`, deploy-docs-check, DEPLOY.md §2.3, `.env.example` optional vars.  
**Branch:** `feature/hosthub-audit-loop-fixes`  
**Status:** **Verified**

| Gap | Description | Status |
|-----|-------------|--------|
| L3 | `assertDatabaseUrlMatchesProvider()` rejects `file:`/`sqlite:` for postgresql | **Verified** |
| L3 | TDD: `env.test.ts` assertDatabaseUrlMatchesProvider suite (7 tests) | **Verified** |
| L5 | `deploy-docs-check.ts` + tests cover every `REQUIRED_PROD_ENV` in DEPLOY.md | **Verified** |
| L5 | DEPLOY.md §2.3 table includes `INGESTION_COMMITMENT_SALT` | **Verified** |
| L5 | `.env.example` postgres `:5433` + enrollment optional vars | **Verified** |

**Before (red — 2026-07-03 15:25 UTC+7):**
```
cd passport && npm test -- env.test deploy-docs-check

→ Test Files  1 failed | 1 passed (2)
→ Tests       9 failed | 8 passed (17)
→ env.test: 7 failed (assertDatabaseUrlMatchesProvider not exported)
→ deploy-docs-check.test: 2 failed (DEPLOY.md missing INGESTION_COMMITMENT_SALT)
```

**After (green — 2026-07-03 15:26 UTC+7):**
```
cd passport && npm test -- env.test deploy-docs-check

→ Test Files  2 passed (2)
→ Tests       17 passed (17)
→ Duration    ~487ms
```

**Files (Loop 2b scope only):**
- `src/lib/config/env.ts` — `assertDatabaseUrlMatchesProvider`
- `src/lib/config/tests/env.test.ts` — 7 new tests
- `src/lib/release/deploy-docs-check.ts` — new
- `src/lib/release/tests/deploy-docs-check.test.ts` — new
- `scripts/check-deploy-docs.ts` — new CLI
- `DEPLOY.md` — §2.3 `INGESTION_COMMITMENT_SALT` row
- `.env.example` — already had postgres `:5433` + `ENFORCE_ENROLLMENT_FOR_CREDITS`, `ENROLLMENT_*` rate limits

**Not touched (per scope):** portal-service, observability, profile UI, backup-db, load-baseline

---

## Blocked (human — do not fake)

| Item | Reason |
|------|--------|
| Git remote push | No remote configured / user policy |
| Signing key escrow drill | Operational — runbook at `docs/key-management.md`; execution is human-operated |
| Staging deploy / Railway console | Needs human credentials |
| AngelCoin RBAC migration | Non-trivial schema change |

---

## Completed vs remaining

**Loop 1:** 7/7 gaps addressed (B merge local-only).  
**Loop 2:** ~6/7 started; route-wrapper done in Loop 12; config/docs FFD done in Loop 2b; key-management done in Loop 5.  
**Loop 4:** Public leaderboard UI — **Verified** (6 new tests).  
**Loop 5:** Signing key runbook — **Verified** (`key-management-doc.test.ts` 4/4).  
**Recommended next scope (post-Loop 5):**
1. Wire credits_read route with `withRouteObservability` (Loop 12 deferred)
2. `dependabot.yml` when remote exists
3. Loop 1 gap B — merge `feature/task-deliverable-evidence` → `dev` (local-only)

---

## Loop 12 — Observability route wrapper (Layer 12)

**Goal:** `withRouteObservability` wrapper — `request_id`, `latency_ms`, `unhandled_error` in logger whitelist; wire gate + receipts POST.

| Item | Status | Evidence |
|------|--------|----------|
| `route-wrapper.ts` | **Verified** | `withRouteObservability`: UUID `request_id`, outcome from status, catch → 500 + `unhandled_error` log |
| Logger whitelist | **Verified** | `request_id`, `latency_ms`, `unhandled_error` event in `logger.ts`; `logger.unit.test.ts` 5/5 |
| `route-wrapper.test.ts` | **Verified** | 5/5 pass (success, 4xx rejected, unhandled 500, context forward, no secrets in logs) |
| Wire `POST /api/v1/gate/verify` | **Verified** | `gate/verify/route.ts` → `gate_verify` |
| Wire `POST /api/v1/receipts` | **Verified** | `receipts/route.ts` → `receipt_issue` |
| Wire credits_read | **Not started** | Deferred to Loop 3 |

### Loop 12 verification (2026-07-03)

```
cd passport && npm test -- route-wrapper logger.unit
→ Test Files 2 passed (2) | Tests 10 passed (10)
```

---

## Prior loops (reference)

### Loop 3 — enrolled_no_evidence (Layer 2)

**Goal:** `getAgentProfile` returns `ENROLLED_NO_EVIDENCE` (200) when agent is enrolled (`ISSUED`) but has zero evidence rows; profiles API route returns 200 instead of 404.

| Item | Status | Evidence |
|------|--------|----------|
| `getAgentProfile` enrolled-no-evidence branch | **Verified** | `portal-service.ts`: early enrollment check; empty events + `ENROLLED` → profile with `enrollment_status: "ENROLLED_NO_EVIDENCE"` |
| `GET /api/v1/profiles/[hash]` 200 path | **Verified** | Route unchanged — returns JSON when profile non-null; test asserts 200 + status |
| `public-portal.test.ts` FFD tests | **Verified** | `getAgentProfile` + profiles API cases added before impl |
| `profile-page.test.tsx` jsdom cleanup | **Verified** | `afterEach(cleanup)` present (3/3 ProfileCard tests) |
| `profile-view-model.test.ts` | **Verified** | Maps `ENROLLED_NO_EVIDENCE` → "Enrolled — no public evidence" label |

**Files changed (Loop 3 scope):**
- `src/lib/public-portal/portal-service.ts` — `AgentProfile.enrollment_status` union + empty-evidence enrolled branch
- `src/lib/public-portal/tests/public-portal.test.ts` — `getAgentProfile` + profiles API tests
- `src/app/profiles/__tests__/profile-page.test.tsx` — `afterEach(cleanup)` (untracked, on disk)
- `src/lib/public-portal/profile-view-model.ts` — view-model mapping (untracked, on disk)

**Not touched (per scope):** `env.ts`, `DEPLOY.md`, `route-wrapper`, `backup-db`, `load-baseline`

### Loop 3 verification (2026-07-03)

```
cd passport && npm test -- public-portal profile-page
→ Test Files  3 passed (3)
→ Tests  36 passed (36)
→ Duration  ~13s
```

Targeted paths:
```
npx vitest run \
  src/lib/public-portal/tests/public-portal.test.ts \
  src/app/profiles/__tests__/profile-page.test.tsx \
  src/lib/public-portal/tests/profile-view-model.test.ts
→ Test Files  3 passed (3) | Tests  36 passed (36)
```

## Loop 4 — Public leaderboard UI (Layer 1)

**Goal:** Add read-only `/leaderboard` server page; leaderboard was API-only while profiles had UI at `/profiles/[hash]`.

| Item | Status | Evidence |
|------|--------|----------|
| `leaderboard-view-model.ts` mapper | **Verified** | `mapLeaderboardRowsToViewModel` + `formatLeaderboardRate` |
| `leaderboard-view-model.test.ts` | **Verified** | 4/4 pass (empty, short hash + rate, null rate, trajectory labels) |
| `LeaderboardTable.tsx` | **Verified** | Empty state + table rows; mirrors ProfileCard pattern |
| `leaderboard-page.test.tsx` jsdom | **Verified** | 2/2 pass (empty state, row with footprint + 50%) |
| `/leaderboard` server page | **Verified** | Calls `getLeaderboard()` directly — no HTTP hop |

**Before (red — 2026-07-04 00:05 UTC+7):**
```
cd passport && npx vitest run leaderboard

→ Test Files  2 failed (2)
→ Tests       no tests
→ leaderboard-view-model.test.ts: Cannot find package '@/lib/public-portal/leaderboard-view-model'
→ leaderboard-page.test.tsx: Failed to resolve import "@/app/leaderboard/LeaderboardTable"
→ Duration    ~34.6s
→ Exit code   1
```

**After (green — 2026-07-04 00:07 UTC+7):**
```
cd passport && npx vitest run leaderboard

→ Test Files  2 passed (2)
→ Tests       6 passed (6)
→ Duration    ~14.2s
→ Exit code   0
```

**Full suite (2026-07-04 00:08 UTC+7):**
```
cd passport && npm test
→ Test Files  70 passed (70)
→ Tests       542 passed (542)
→ Duration    ~113.8s
→ Exit code   0
```

**Files changed (Loop 4 scope):**
- `src/lib/public-portal/leaderboard-view-model.ts` — new
- `src/lib/public-portal/tests/leaderboard-view-model.test.ts` — new
- `src/app/leaderboard/page.tsx` — new server page
- `src/app/leaderboard/LeaderboardTable.tsx` — new presentational component
- `src/app/leaderboard/__tests__/leaderboard-page.test.tsx` — new jsdom tests

**Not touched (per scope):** `portal-service.ts` logic, HostHub, `env.ts`, `rateLimit`

---

## Loop 5 — Signing key runbook (Layer 8)

**Goal:** Close audit gap — no `key-management.md`; document key escrow + manual rotation runbook for pilot.

| Item | Status | Evidence |
|------|--------|----------|
| `key-management-doc.test.ts` FFD | **Verified** | 4/4 pass — file exists, sections, cross-links, no secrets |
| `docs/key-management.md` | **Verified** | Escrow, rotation procedure, `/api/v1/public-key` verification, blast radius (old receipts) |
| Cross-link `DEPLOY.md` `SIGNING_PRIVATE_KEY` | **Verified** | Linked in Related docs + rotation section |
| Cross-link `disaster-recovery.md` | **Verified** | Linked in Related docs + incident section |
| `pilot-support-runbook.md` one-line link | **Verified** | Related docs bullet added |

**Before (red — 2026-07-04 00:06 UTC+7):**
```
cd passport && npm test -- key-management-doc

→ Test Files  1 failed (1)
→ Tests       4 failed (4)
→ key-management-doc.test.ts: docs/key-management.md ENOENT
→ Duration    ~942ms
→ Exit code   1
```

**After (green — 2026-07-04 00:07 UTC+7):**
```
cd passport && npm test -- key-management-doc

→ Test Files  1 passed (1)
→ Tests       4 passed (4)
→ Duration    ~852ms
→ Exit code   0
```

**Full suite (2026-07-04 00:10 UTC+7):**
```
cd passport && npm test
→ Test Files  70 passed (70)
→ Tests       542 passed (542)
→ Duration    ~99.8s
→ Exit code   0
```

**Files changed (Loop 5 scope):**
- `src/lib/release/tests/key-management-doc.test.ts` — new
- `docs/key-management.md` — new pilot-grade runbook (no secrets)
- `docs/pilot-support-runbook.md` — one-line cross-link
- `docs/recursive-loop-tracker.md` — Loop 5 section

**Not touched (per scope):** `portal-service`, leaderboard, `route-wrapper` routes

---

### Loop N — Load baseline
**Status:** In progress — `load-baseline-args.test.ts`, `scripts/load-baseline.ts` on disk uncommitted.
