# Passport AngelCoin + Rollout Proof Packet

**Workspace:** `passport/`  
**Generated:** 2026-06-18 (read-only codebase inspection)  
**Scope:** AngelCoin 5-phase build, prior GitHub evidence rollout hardening, staging deploy runbook alignment.

> **Note on file inventory:** This workspace is not a git repository (no `.git` at `passport/` or parent `continual-harness-main/`). File lists below are enumerated via filesystem inspection, not `git diff`.

---

## Executive summary

AngelCoin is implemented as an **append-only journal ledger** keyed by `subjectCommitment` (64-hex agent identity commitment), with **on-demand balance projection** from journal entries and a **hybrid access-tier model** (fresh on-read `accessTier` plus additive `storedAccessTier` exposing the materialized DB value). Eight API routes exist: four Bearer-authenticated mutation routes and four public, IP rate-limited read routes. **`Operator.credits` (Stripe billing credits) is fully separate** — no AngelCoin code reads or mutates `Operator.credits`. Staging rollout commands are documented in `docs/passport-github-rollout.md` including AngelCoin mutation auth and `npm run smoke:angelcoin`.

---

## 1. Files changed/added

### 1.1 AngelCoin 5-phase build (inferred phase mapping from code structure)

| Phase | Purpose | Files |
|-------|---------|-------|
| **1 — Schema & migration** | Prisma models, enums, SQL migration | `prisma/schema.prisma` (AngelCoin section), `prisma/migrations/20260618000000_add_angelcoin_ledger/migration.sql` |
| **2 — Ledger core** | Append-only journal, transfers, locks | `src/lib/angelcoin/ledger-service.ts`, `src/lib/angelcoin/balances.ts`, `src/lib/angelcoin/errors.ts`, `src/lib/angelcoin/tests/ledger-service.test.ts`, `src/lib/angelcoin/tests/ledger.test.ts` |
| **3 — Access tiers** | Threshold evaluation, admin override, persistence | `src/lib/angelcoin/access-tiers.ts`, `src/lib/angelcoin/tests/access-tiers.test.ts` |
| **4 — Projections** | Passport/agent/live read models | `src/lib/angelcoin/projections.ts`, `src/lib/angelcoin/tests/projections.test.ts` |
| **5 — API + validation** | Eight routes, Zod schemas, route error mapping, route tests | `src/lib/validation/angelcoinSchemas.ts`, `src/lib/angelcoin/route-errors.ts`, `src/lib/angelcoin/tests/angelcoin-routes.test.ts`, plus all eight route files under `src/app/api/v1/passport/` (listed below) |

**Complete AngelCoin file list (27 files):**

```
prisma/schema.prisma                                    # modified (AngelCoin models/enums appended)
prisma/migrations/20260618000000_add_angelcoin_ledger/migration.sql

src/lib/angelcoin/access-tiers.ts
src/lib/angelcoin/balances.ts
src/lib/angelcoin/errors.ts
src/lib/angelcoin/ledger-service.ts
src/lib/angelcoin/projections.ts
src/lib/angelcoin/route-errors.ts
src/lib/angelcoin/tests/access-tiers.test.ts
src/lib/angelcoin/tests/angelcoin-routes.test.ts
src/lib/angelcoin/tests/ledger.test.ts
src/lib/angelcoin/tests/ledger-service.test.ts
src/lib/angelcoin/tests/projections.test.ts

src/lib/validation/angelcoinSchemas.ts

src/app/api/v1/passport/credits/grants/route.ts
src/app/api/v1/passport/credits/transfers/route.ts
src/app/api/v1/passport/access/evaluate/route.ts
src/app/api/v1/passport/access/override/route.ts
src/app/api/v1/passport/agents/[id]/credits/route.ts
src/app/api/v1/passport/agents/[id]/access-tier/route.ts
src/app/api/v1/passport/agents/[id]/credit-journal/route.ts
src/app/api/v1/passport/agents/[id]/passport-live/route.ts
```

### 1.2 Prior rollout hardening (GitHub evidence + operator runbook)

These files support staging/prod rollout documented in `docs/passport-github-rollout.md` and are **relevant** to deploying AngelCoin (shared migration pipeline, env checks, minter seed):

```
docs/passport-github-rollout.md

prisma/migrations/20260615000000_concurrency_safe_escrow_ledger/migration.sql
prisma/migrations/20260616000000_deploy_selective_disclosure_commitments/migration.sql
prisma/migrations/20260616100000_add_agent_evidence/migration.sql
prisma/migrations/20260616120000_add_evidence_receipt_link/migration.sql

scripts/check-env.ts
scripts/doctor-passport.ts
scripts/seed-evidence-minter.ts
scripts/smoke-passport-github.ts

src/lib/config/env.ts
src/lib/config/tests/env.test.ts
src/lib/release/passport-doctor.ts
src/lib/release/seed-minter-args.ts
src/lib/release/smoke-args.ts
src/lib/release/tests/passport-doctor.test.ts
src/lib/release/tests/seed-minter-args.test.ts
src/lib/release/tests/smoke-args.test.ts

src/lib/evidence-bridge/evidence-receipt-bridge.ts
src/lib/evidence-bridge/predicates.ts
src/lib/evidence-bridge/tests/evidence-receipt-bridge.test.ts
src/lib/evidence-bridge/tests/predicates.test.ts
src/lib/ingestion/github-agent-adapter.ts
src/lib/ingestion/tests/github-telemetry.test.ts
src/lib/public-portal/portal-service.ts
src/lib/public-portal/tests/public-portal.test.ts
```

---

## 2. Final schema / model list

**Datasource:** PostgreSQL via `DATABASE_URL`.

### Enums (all)

| Enum | Values |
|------|--------|
| `ErrorTranche` | `DATA_LEAKAGE`, `COMPUTE_TIMEOUT`, `LOGIC_DETECTION`, `SLA_BREACH`, `NONE` |
| `OperationalDomain` | `FINANCIAL_CLEARING`, `CUSTOMER_SUPPORT`, `CODE_GENERATION`, `SYSTEM_INTEGRATION` |
| `OperatorAccountStatus` | `ACTIVE`, `ESCROW_INSOLVENT_BLOCKED` |
| `EvidenceLinkageType` | `OBSERVATION`, `CORRECTION`, `FAILURE`, `VALIDATION` |
| `EvidenceEnforcementState` | `OBSERVATIONAL_ONLY`, `AUDIT_RELEVANT`, `ENFORCEMENT_ELIGIBLE` |
| `AngelCoinCreditState` | `ACTIVE`, `TRANSITION`, `INACTIVE` |
| `AngelCoinEntryType` | `OPERATOR_GRANT`, `PEER_GIFT`, `TASK_PAYMENT`, `SAFETY_NET_TOPUP`, `RECOVERY_AWARD`, `SPEND`, `LOCK`, `UNLOCK`, `ADJUSTMENT` |
| `AccessTier` | `FULL`, `LIMITED`, `SANDBOXED`, `SHELTERED`, `SUSPENDED` |

### Models (14 total)

| Model | Primary purpose |
|-------|-----------------|
| `Operator` | Stripe-anchored operator; **`credits` Int** for billing (separate from AngelCoin) |
| `Agent` | Operator-scoped agent registration |
| `Receipt` | Signed custody/competence receipts |
| `ApiKey` | Bearer API key hashes for operator auth |
| `StripeEvent` | Webhook idempotency |
| `MatchLedgerEntry` | Payout-critical settlement events |
| `SlashingLedger` | Economic slashing audit trail |
| `CapabilityLedgerEntry` | Reputation aggregation events |
| `AgentEvidence` | Privacy-safe GitHub/OTel evidence (`agentIdentityCommitment`) |
| `EvidenceReceiptLink` | Bridge from evidence to receipts |
| **`AngelCoinAccount`** | AngelCoin ledger account keyed by `subjectCommitment` |
| **`AngelCoinJournalEntry`** | Append-only AngelCoin journal lines |

**AngelCoinAccount fields:** `id`, `subjectCommitment` (unique), `creditState`, `accessTier`, `adminOverrideTier`, `backingMetadata`, `createdAt`, `updatedAt`, relation `journal`.

**AngelCoinJournalEntry fields:** `id`, `accountId`, `entryType`, `amount`, `counterpartyCommitment`, `metadata`, `createdAt`, relation `account`.

---

## 3. Eight API routes (method + path + auth)

| # | Method | Path | Auth |
|---|--------|------|------|
| 1 | `POST` | `/api/v1/passport/credits/grants` | **Bearer API key** (`Authorization: Bearer pp_…`) via `authenticateApiKey` |
| 2 | `POST` | `/api/v1/passport/credits/transfers` | **Bearer API key** |
| 3 | `POST` | `/api/v1/passport/access/evaluate` | **Bearer API key** |
| 4 | `POST` | `/api/v1/passport/access/override` | **Bearer API key** |
| 5 | `GET` | `/api/v1/passport/agents/:id/credits` | **Public** (no Bearer); IP rate limit `angelcoin-credits:{ip}` |
| 6 | `GET` | `/api/v1/passport/agents/:id/access-tier` | **Public**; IP rate limit `angelcoin-tier:{ip}` |
| 7 | `GET` | `/api/v1/passport/agents/:id/credit-journal` | **Public**; IP rate limit `angelcoin-journal:{ip}`; optional `?limit=` (default 50, max 100) |
| 8 | `GET` | `/api/v1/passport/agents/:id/passport-live` | **Public**; IP rate limit `angelcoin-live:{ip}` |

**Path param `:id`:** Must be a **64-character hex string** (same validation as `agentIdentityCommitment` / `subjectCommitment`).

**Bearer auth implementation** (`src/lib/operator.ts`):

```typescript
// Requires header: Authorization: Bearer <raw_api_key>
// Looks up ApiKey.keyHash → returns Operator row (auth only; AngelCoin mutations do not debit Operator.credits)
export async function authenticateApiKey(authHeader: string | null)
```

---

## 4. Sample request/response payloads

Use a valid commitment: `"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"` (64 hex chars).

### 4.1 `POST /api/v1/passport/credits/grants` — 201

**Request** (from `grantCreditsBodySchema`):

```json
{
  "subject_commitment": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "amount": 100,
  "metadata": "initial-allocation"
}
```

**Response** (from route handler + `grantCredits` return):

```json
{
  "subject_commitment": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "entry": {
    "id": "clx…",
    "accountId": "clx…",
    "entryType": "OPERATOR_GRANT",
    "amount": 100,
    "counterpartyCommitment": null,
    "metadata": "initial-allocation",
    "createdAt": "2026-06-18T12:00:00.000Z"
  },
  "balances": {
    "grantedBalance": 100,
    "earnedBalance": 0,
    "spentBalance": 0,
    "lockedBalance": 0,
    "availableBalance": 100
  }
}
```

**Errors:** `401` unauthorized, `400` validation/invalid commitment, `500` unhandled.

---

### 4.2 `POST /api/v1/passport/credits/transfers` — 200

**Request** (from `transferCreditsBodySchema`):

```json
{
  "from_commitment": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "to_commitment": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  "amount": 25,
  "kind": "TASK_PAYMENT"
}
```

`kind` optional; defaults to `"TASK_PAYMENT"` in service. `"PEER_GIFT"` creates `PEER_GIFT` on receiver side.

**Response:**

```json
{
  "sender_entry": {
    "id": "clx…",
    "entryType": "SPEND",
    "amount": 25,
    "counterpartyCommitment": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  },
  "receiver_entry": {
    "id": "clx…",
    "entryType": "TASK_PAYMENT",
    "amount": 25,
    "counterpartyCommitment": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  },
  "balances": {
    "grantedBalance": 100,
    "earnedBalance": 0,
    "spentBalance": 25,
    "lockedBalance": 0,
    "availableBalance": 75
  }
}
```

**Errors:** `402` insufficient funds, `404` account not found (mapped from service errors), `400` same-account transfer / invalid amount.

---

### 4.3 `POST /api/v1/passport/access/evaluate` — 200

**Request** (from `accessEvaluateBodySchema`):

```json
{
  "subject_commitment": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
}
```

**Response** (from `applyAccessEvaluation`):

```json
{
  "subject_commitment": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "evaluation": {
    "tier": "LIMITED",
    "reason": "low_balance_limited"
  },
  "balances": {
    "grantedBalance": 100,
    "earnedBalance": 0,
    "spentBalance": 75,
    "lockedBalance": 0,
    "availableBalance": 25
  },
  "access_tier": "LIMITED"
}
```

Persists `accessTier` on `AngelCoinAccount`.

---

### 4.4 `POST /api/v1/passport/access/override` — 200

**Request** (from `accessOverrideBodySchema`):

```json
{
  "subject_commitment": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "tier": "FULL"
}
```

Set `"tier": null` to clear override.

**Response** (from `setAdminOverride`):

```json
{
  "subject_commitment": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "evaluation": {
    "tier": "FULL",
    "reason": "admin_override"
  },
  "balances": { "grantedBalance": 100, "earnedBalance": 0, "spentBalance": 0, "lockedBalance": 0, "availableBalance": 100 },
  "admin_override_tier": "FULL",
  "access_tier": "FULL"
}
```

---

### 4.5 `GET /api/v1/passport/agents/:id/credits` — 200

**Request:** no body. `:id` = subject commitment.

**Response** (from `getAccountBalances`):

```json
{
  "subject_commitment": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "credit_state": "ACTIVE",
  "access_tier": "FULL",
  "balances": {
    "grantedBalance": 100,
    "earnedBalance": 0,
    "spentBalance": 0,
    "lockedBalance": 0,
    "availableBalance": 100
  }
}
```

**Note:** Returns **stored** `account.accessTier`, not freshly evaluated tier. `404` if no account exists.

---

### 4.6 `GET /api/v1/passport/agents/:id/access-tier` — 200

**Response** (from `getAccessTierEvaluation` — **on-read evaluation**):

```json
{
  "subject_commitment": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "tier": "SANDBOXED",
  "reason": "low_balance_sandbox",
  "admin_override_tier": null,
  "stored_access_tier": "FULL",
  "available_balance": 5
}
```

Exposes both computed `tier` and **stored** `stored_access_tier` for drift visibility.

---

### 4.7 `GET /api/v1/passport/agents/:id/credit-journal?limit=10` — 200

**Response** (from `listJournalEntries`, newest first):

```json
{
  "subject_commitment": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "entries": [
    {
      "id": "clx…",
      "entry_type": "OPERATOR_GRANT",
      "amount": 100,
      "counterparty_commitment": null,
      "metadata": null,
      "created_at": "2026-06-18T12:00:00.000Z"
    }
  ]
}
```

---

### 4.8 `GET /api/v1/passport/agents/:id/passport-live` — 200

**Response** (from `buildLiveStatus(account)`):

```json
{
  "subjectCommitment": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "availableBalance": 100,
  "lockedBalance": 0,
  "accessTier": "FULL",
  "accessReason": "sufficient_balance",
  "creditState": "ACTIVE",
  "statusLabel": "active",
  "journalEntryCount": 1,
  "asOf": "2026-06-18T12:00:00.000Z"
}
```

**404** if account missing (explicit check in route). Uses camelCase field names (projection output, not snake_case like other routes).

---

### Validation error shape (all POST routes)

```json
{
  "error": "Validation failed",
  "issues": { "fieldErrors": { … }, "formErrors": [ … ] }
}
```

---

## 5. Migration summary: `20260618000000_add_angelcoin_ledger`

**File:** `prisma/migrations/20260618000000_add_angelcoin_ledger/migration.sql`

| Action | Detail |
|--------|--------|
| **Create enums** | `AngelCoinCreditState`, `AngelCoinEntryType`, `AccessTier` |
| **Create table** | `AngelCoinAccount` with defaults: `creditState=ACTIVE`, `accessTier=FULL` |
| **Create table** | `AngelCoinJournalEntry` with FK to `AngelCoinAccount.id` |
| **Indexes** | Unique on `AngelCoinAccount.subjectCommitment`; index on `subjectCommitment`; index on `AngelCoinJournalEntry.accountId` |
| **FK constraint** | `AngelCoinJournalEntry.accountId → AngelCoinAccount.id` **`ON DELETE RESTRICT ON UPDATE CASCADE`** |
| **Not present** | No DB triggers enforcing append-only; no balance cache columns; no link to `Operator` or `AgentEvidence` tables |

---

## 6. Append-only journal integrity (application layer)

**Source:** `src/lib/angelcoin/ledger-service.ts`

| Mechanism | Detail |
|-----------|--------|
| **Single write path** | All journal mutations go through `appendEntry()`, which only calls `tx.angelCoinJournalEntry.create()` |
| **No update/delete API** | Grep of `src/lib/angelcoin/` finds **zero** `angelCoinJournalEntry.update` or `.delete` calls |
| **No exported mutators** | No service function exposes journal edit or delete |
| **Amount validation** | Non-`ADJUSTMENT` entries require `amount > 0`; `ADJUSTMENT` rejects zero |
| **Concurrency** | `transferCredits` uses `$transaction`, `SELECT … FOR UPDATE` on sender account (`lockAccountForUpdate`) |
| **DB gap** | Append-only is **not** enforced by PostgreSQL triggers or RLS; direct DB/admin access could still mutate rows |

```typescript
// appendEntry — only create, never update/delete
return tx.angelCoinJournalEntry.create({ data: { accountId, entryType, amount, … } });
```

---

## 7. Balance computation (on-demand vs cached)

**Source:** `src/lib/angelcoin/balances.ts`, used by `ledger-service.ts` and `projections.ts`

| Aspect | Behavior |
|--------|----------|
| **Storage** | No cached balance columns on `AngelCoinAccount` |
| **Computation** | **On-demand** via `computeBalances(entries)` every time balances are needed |
| **Formula** | `availableBalance = grantedBalance + earnedBalance - spentBalance - lockedBalance + adjustmentTotal` |
| **Granted** | Sum of `OPERATOR_GRANT` |
| **Earned** | Sum of `PEER_GIFT`, `TASK_PAYMENT`, `SAFETY_NET_TOPUP`, `RECOVERY_AWARD` |
| **Spent** | Sum of `SPEND` |
| **Locked** | `max(0, sum(LOCK) - sum(UNLOCK))` |
| **Adjustments** | Sum of `ADJUSTMENT` (can be negative; only type allowing non-positive amounts at service layer) |
| **Load pattern** | `loadJournalEntries(accountId)` → full journal ordered `createdAt asc` → `computeBalances` |

Write endpoints (`grantCredits`, `transferCredits`, etc.) reload journal after append and return freshly computed balances in the HTTP response.

---

## 8. Tier thresholds and override rules

**Source:** `src/lib/angelcoin/access-tiers.ts`

```typescript
export const LIMITED_THRESHOLD = 50;
export const SANDBOX_THRESHOLD = 10;
```

**Evaluation order** (`evaluateAccessTier`):

| Priority | Condition | Tier | Reason string |
|----------|-----------|------|-----------------|
| 1 | `adminOverrideTier != null` | Override tier | `"admin_override"` |
| 2 | `creditState === INACTIVE` | `SUSPENDED` | `"credit_inactive"` |
| 3 | `availableBalance <= 0` | `SHELTERED` | `"safety_net_floor"` |
| 4 | `availableBalance < 10` | `SANDBOXED` | `"low_balance_sandbox"` |
| 5 | `availableBalance < 50` | `LIMITED` | `"low_balance_limited"` |
| 6 | else | `FULL` | `"sufficient_balance"` |

**Override rules:**

- `POST /access/override` → `setAdminOverride(commitment, tier | null)` sets `adminOverrideTier`, then calls `applyAccessEvaluation` to persist `accessTier`.
- Override **wins** over balance-derived tier until cleared (`tier: null`).
- `lockedBalance` is passed into evaluation input but **not used** in tier logic today (only `availableBalance`, `creditState`, `adminOverrideTier` affect outcome).

**Persistence:** Only `applyAccessEvaluation` and `setAdminOverride` write `AngelCoinAccount.accessTier`. **`grantCredits` / `transferCredits` do not auto-update tier.**

---

## 9. Agent passport projection — event/mutation path

**Sources:** `src/lib/angelcoin/projections.ts`, `src/lib/angelcoin/ledger-service.ts`, `src/lib/angelcoin/access-tiers.ts`

### Read models

| Function | Used by | Input |
|----------|---------|-------|
| `buildPassportReadModel` | Internal; basis for agent/live | `AngelCoinAccount` + full `journal[]` |
| `buildAgentReadModel` | Not wired to a route directly | Same source |
| `buildLiveStatus` | `GET …/passport-live` | Same source |

### Computation model

- **Balances:** Always recomputed from journal on read (`computeBalances(account.journal)`).
- **Tier in projection:** `buildPassportReadModel` sets `accessTier: account.accessTier ?? evaluation.tier` — prefers **stored** DB tier when present.
- **Materialization:** Partially materialized — `accessTier` column updated only via explicit `applyAccessEvaluation` / `setAdminOverride`; **not** on every journal append.

### Mutation → projection flow

```
Journal append (grant/transfer/lock/…)
  → appendEntry (create row)
  → write response includes computeBalances(reloaded journal)  ✅ canonical for that write

Stored accessTier
  → updated ONLY by POST /access/evaluate or POST /access/override
  → NOT updated by grant/transfer

GET /passport-live
  → loadAccountWithJournal (on-read)
  → buildLiveStatus → buildPassportReadModel
  → balances fresh from journal; tier may use stale stored accessTier

GET /access-tier
  → getAccessTierEvaluation (fresh evaluateAccessTier + exposes stored_access_tier)
```

### Projection consistency assessment

| Dimension | Consistency |
|-----------|-------------|
| **Balances on write response** | **Strong** — returned balances computed from journal including new entry |
| **Balances on read routes** | **Strong** — always derived from current journal (no cache) |
| **Access tier on write response** | **Not returned** on grant/transfer; tier unchanged unless evaluate called |
| **Access tier on `passport-live`** | **Potentially lagging** — uses stored `account.accessTier` when set, even if journal balance would imply a different tier |
| **Access tier on `GET …/access-tier`** | **Computed tier is fresh**; response also shows `stored_access_tier` for comparison |
| **Cross-view drift** | Tests in `projections.test.ts` assert passport/agent/live agree **when built from the same account snapshot**; drift appears when stored `accessTier` is stale vs journal |

**Verdict:** Hybrid model — **journal is source of truth for balances**; **stored `accessTier` is a lagging materialized field** unless operators call `/access/evaluate` after mutations.

---

## 10. API auth patterns

| Route group | Pattern |
|-------------|---------|
| **Mutations** (`POST` grants, transfers, evaluate, override) | `Authorization: Bearer <api_key>` required; `authenticateApiKey` returns `Operator` or `401` |
| **Reads** (`GET` agents/:id/*) | **No Bearer**; public with in-memory IP rate limiting (`checkInMemoryRateLimit`) |
| **Invalid Bearer** | `401 { "error": "Unauthorized" }` |
| **Rate limit** | `429 { "error": "Rate limit exceeded" }` + optional `Retry-After` header |

AngelCoin mutation auth validates **operator identity for authorization** but does **not** tie grants to `Operator.credits` balance.

---

## 11. `Operator.credits` separation from AngelCoin

| Check | Result |
|-------|--------|
| AngelCoin lib imports `decrementCredits` / `Operator`? | **No matches** in `src/lib/angelcoin/` |
| `grantCredits` debits `Operator.credits`? | **No** — only appends `OPERATOR_GRANT` journal entry |
| `OPERATOR_GRANT` entry type | Namesake only; **not** coupled to `Operator.credits` field |
| `Operator.credits` mutation sites | `src/lib/operator.ts` (`decrementCredits`), `src/lib/stripe.ts`, `src/lib/billing-audit.ts` — billing/receipt paths only |
| Cross-ledger in single transaction? | **None found** between AngelCoin journal and Operator.credits |

**Conclusion:** AngelCoin and `Operator.credits` are **separate economic systems** in code.

---

## 12. Canonical Passport identity for AngelCoin

| Concept | Field | Location |
|---------|-------|----------|
| **AngelCoin account key** | `AngelCoinAccount.subjectCommitment` | Unique 64-hex string |
| **GitHub evidence key** | `AgentEvidence.agentIdentityCommitment` | Same format, indexed |
| **Public route param** | `:id` on `GET /agents/:id/*` | Validated via `isValidAgentCommitmentHash` → `/^[0-9a-f]{64}$/i` |
| **API body field** | `subject_commitment`, `from_commitment`, `to_commitment` | Same regex in Zod schemas |

**Relationship:** Logical identity alignment (`subjectCommitment` ≡ `agentIdentityCommitment` as the same commitment hash convention). **No foreign key** links `AngelCoinAccount` to `AgentEvidence` or `Agent` tables — accounts are created on first grant/transfer via `getOrCreateAccount`.

---

## 13. New Prisma models from `add_angelcoin_ledger` migration

Exactly **two** new models (plus three enums):

1. **`AngelCoinAccount`**
2. **`AngelCoinJournalEntry`**

---

## 14. Staging deploy commands (in order)

From `docs/passport-github-rollout.md` + `package.json`:

```bash
# 1. Confirm artifact (local)
npm test
npm run build

# 2. Set staging env vars (platform) — leave risky flags disabled initially
#    Required: DATABASE_URL (postgresql://), SIGNING_PRIVATE_KEY, INGESTION_COMMITMENT_SALT

# 3. Seed evidence minter (idempotent; capture Operator.id)
DATABASE_URL=postgresql://... npm run seed:evidence-minter

# 4. Set EVIDENCE_BRIDGE_OPERATOR_ID=<printed Operator.id>
#    Leave EVIDENCE_ENFORCEMENT_ENABLED unset/false

# 5. Env preflight
NODE_ENV=staging npm run check:env

# 6. Release doctor (read-only)
NODE_ENV=staging npm run doctor:passport

# 7. Backup database

# 8. Migration status
npm run db:status

# 9. Apply migrations (includes 20260618000000_add_angelcoin_ledger)
npx prisma migrate deploy
# Alternative preflight: npm run db:preflight  # status + prisma generate

# 10. Deploy app (build includes prisma generate via postinstall)
npm run build
# production start: npm start  # runs prestart check:env --prestart-only for staging/prod

# 11. Smoke probes (GitHub public portal — does NOT cover AngelCoin routes today)
BASE_URL=https://staging.passport.example.com npm run smoke:github

# 12. Enable EVIDENCE_ENFORCEMENT_ENABLED only after monitoring healthy
```

**Pending migrations order (all five):**

1. `20260615000000_concurrency_safe_escrow_ledger`
2. `20260616000000_deploy_selective_disclosure_commitments`
3. `20260616100000_add_agent_evidence`
4. `20260616120000_add_evidence_receipt_link`
5. `20260618000000_add_angelcoin_ledger`

**Relevant `package.json` scripts:**

| Script | Command |
|--------|---------|
| `db:status` | `prisma migrate status` |
| `db:preflight` | `prisma migrate status && prisma generate` |
| `db:migrate` | `prisma migrate dev` (**dev only — not staging/prod**) |
| `db:generate` | `prisma generate` |
| `seed:evidence-minter` | `tsx scripts/seed-evidence-minter.ts` |
| `check:env` | `tsx scripts/check-env.ts` |
| `doctor:passport` | `tsx scripts/doctor-passport.ts` |
| `smoke:github` | `tsx scripts/smoke-passport-github.ts` |
| `build` | `prisma generate && next build` |

---

## Operational-side checklist

| Step | AngelCoin-specific? | Status in runbook |
|------|----------------------|-------------------|
| `DATABASE_URL` PostgreSQL | Shared | Documented |
| `npx prisma migrate deploy` | Creates AngelCoin tables | Documented (migration #5) |
| `npm run seed:evidence-minter` | Evidence bridge only | Documented |
| AngelCoin API key for mutations | Operator must have `ApiKey` row | **Not documented** |
| Post-grant `POST /access/evaluate` | Recommended to sync stored tier | **Not documented** |
| AngelCoin smoke tests | No script probes `/api/v1/passport/*` | **Gap** |
| Env vars for AngelCoin | None beyond shared DB | N/A |

**Suggested manual AngelCoin smoke (not in repo scripts):**

```bash
# After migrate deploy + API key provisioned:
curl -X POST "$BASE_URL/api/v1/passport/credits/grants" \
  -H "Authorization: Bearer pp_…" -H "Content-Type: application/json" \
  -d '{"subject_commitment":"<64-hex>","amount":100}'

curl "$BASE_URL/api/v1/passport/agents/<64-hex>/passport-live"
```

---

## Assessment: done vs pending

| Layer | Status | Notes |
|-------|--------|-------|
| **Code-side** | **Done** | Schema, migration, ledger service, tiers, projections, 8 routes, Zod validation, unit/route tests |
| **Architecture-side** | **Done with known hybrid** | Append-only journal + on-demand balances; stored `accessTier` can lag until evaluate; no Operator.credits coupling |
| **Operational-side** | **Partially pending** | Shared rollout runbook covers DB migrate; missing AngelCoin smoke, tier-reevaluation ops guidance, mutation API key provisioning docs |

---

## Questions answered (index)

| # | Question | Section |
|---|----------|---------|
| 1 | Exact files changed/added | §1 |
| 2 | Final schema/model list | §2 |
| 3 | Eight API routes (method + path + auth) | §3 |
| 4 | Sample request/response payloads | §4 |
| 5 | Migration summary `20260618000000_add_angelcoin_ledger` | §5 |
| 6 | Append-only journal integrity (application layer) | §6 |
| 7 | Balance computation (on-demand vs cached) | §7 |
| 8 | Tier thresholds and override rules | §8 |
| 9 | Passport projection event/mutation path | §9 |
| 10 | API auth patterns (Bearer vs public) | §10 |
| 11 | `Operator.credits` separation | §11 |
| 12 | Canonical identity (`subjectCommitment`) | §12 |
| 13 | New Prisma models from migration | §13 |
| 14 | Staging deploy commands in order | §14 |

**Also covered:** Projection consistency (§9), operational checklist (Operational-side checklist), tri-layer assessment (Assessment section).

---

## Key code references

**Append-only create path:**

```98:129:passport/src/lib/angelcoin/ledger-service.ts
/**
 * Appends a journal entry (append-only).
 */
export async function appendEntry(
  tx: PrismaTx,
  accountId: string,
  entryType: AngelCoinEntryType,
  amount: number,
  opts?: {
    counterpartyCommitment?: string;
    metadata?: string;
  }
): Promise<AngelCoinJournalEntry> {
  // … validation …
  return tx.angelCoinJournalEntry.create({
    data: {
      accountId,
      entryType,
      amount,
      counterpartyCommitment: opts?.counterpartyCommitment ?? null,
      metadata: opts?.metadata ?? null,
    },
  });
}
```

**On-demand balance formula:**

```64:77:passport/src/lib/angelcoin/balances.ts
  const lockedBalance = Math.max(0, lockTotal - unlockTotal);
  const availableBalance =
    grantedBalance +
    earnedBalance -
    spentBalance -
    lockedBalance +
    adjustmentTotal;

  return {
    grantedBalance,
    earnedBalance,
    spentBalance,
    lockedBalance,
    availableBalance,
  };
```

**Tier thresholds:**

```16:55:passport/src/lib/angelcoin/access-tiers.ts
export const LIMITED_THRESHOLD = 50;
export const SANDBOX_THRESHOLD = 10;
// …
export function evaluateAccessTier(input: AccessTierInput): AccessTierEvaluation {
  if (input.adminOverrideTier != null) {
    return { tier: input.adminOverrideTier, reason: "admin_override" };
  }
  if (input.creditState === AngelCoinCreditState.INACTIVE) {
    return { tier: AccessTier.SUSPENDED, reason: "credit_inactive" };
  }
  if (input.availableBalance <= 0) {
    return { tier: AccessTier.SHELTERED, reason: "safety_net_floor" };
  }
  if (input.availableBalance < SANDBOX_THRESHOLD) {
    return { tier: AccessTier.SANDBOXED, reason: "low_balance_sandbox" };
  }
  if (input.availableBalance < LIMITED_THRESHOLD) {
    return { tier: AccessTier.LIMITED, reason: "low_balance_limited" };
  }
  return { tier: AccessTier.FULL, reason: "sufficient_balance" };
}
```

**Projection tier preference (stored vs computed):**

```17:35:passport/src/lib/angelcoin/projections.ts
export function buildPassportReadModel(account: AngelCoinAccountWithJournal) {
  const balances = computeBalances(account.journal);
  const evaluation = evaluateAccessTier({ … });

  return {
    subjectCommitment: account.subjectCommitment,
    creditState: account.creditState,
    accessTier: account.accessTier ?? evaluation.tier,
    accessReason: evaluation.reason,
    // …
  };
}
```
