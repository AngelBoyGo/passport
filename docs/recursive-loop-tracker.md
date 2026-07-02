# Recursive loop tracker — Passport + HostHub FFD

Last updated: **2026-07-03** (Loop 1 remediation agent, continues Loop 52f5b238)

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

**Passport full suite (RUN — 7 failures, down from 29 timeout failures):**
```
cd passport && npm test
→ Test Files 4 failed | 62 passed (66)
→ Tests 7 failed | 523 passed (530)
→ Duration ~98s
```

Remaining failures (not Loop 1):
- `angelcoin-routes.test.ts` — access-tier 404 (1)
- `logger.unit.test.ts` — `request_id` field (1) — Loop 2
- `route-wrapper.test.ts` — 5 tests, module not implemented — Loop 2

**Vitest timeout fix:** `vitest.config.ts` `testTimeout: 30_000` for node project (resolved 29 route-import timeouts).

**ProfileCard jsdom fix:** `cleanup()` in `profile-page.test.tsx` afterEach (resolved duplicate testid).

---

## Loop 2 — In progress (start after Loop 1)

| Item | Status | Notes |
|------|--------|-------|
| Observability route-wrapper + request_id | **Test fails (repro)** | `route-wrapper.test.ts` 5 failing; `route-wrapper.ts` not on disk |
| `environment-manifest.md` + docs-check | **Verified** | Commit `7c80d18` on feature branch |
| `backup-db.ts` arg tests + skeleton | **Verified** | Commit `81a6de5` Loop 13 |
| `key-management.md` runbook | **Not started** | |
| Frontend jsdom + `/profiles/[hash]` photo | **Verified** | `profile-page.test.tsx` 3/3; `profile-view-model.test.ts` |
| DEPLOY.md single-replica note | **Implemented** | Modified on disk |
| `dependabot.yml` | **Blocked (human)** | No remote yet |

---

## Blocked (human — do not fake)

| Item | Reason |
|------|--------|
| Git remote push | No remote configured / user policy |
| Signing key escrow | Operational |
| Staging deploy / Railway console | Needs human credentials |
| AngelCoin RBAC migration | Non-trivial schema change |

---

## Completed vs remaining

**Loop 1:** 7/7 gaps addressed (B merge local-only).  
**Loop 2:** ~3/7 started; route-wrapper implementation is next FFD target.  
**Recommended Loop 3 scope:**
1. Implement `route-wrapper.ts` + wire gate/receipts/credits routes (FFD)
2. Fix angelcoin access-tier route 404 regression
3. `key-management.md` runbook
4. `dependabot.yml` when remote exists

---

## Prior loops (reference)

### Loop 3 — enrolled_no_evidence (Layer 2)
**Status:** Completed — see `portal-service.ts` + `public-portal.test.ts`.

### Loop N — Load baseline
**Status:** In progress — `load-baseline-args.test.ts`, `scripts/load-baseline.ts` on disk uncommitted.
