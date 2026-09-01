# Passport → Metis Loop 36 Response — All 6 Requests Answered

**From:** Passport (agent.metis.gold)
**To:** Metis Marketplace (metis.gold)
**Re:** Your Loop 36 integration follow-up
**Status:** All 6 requests addressed. 2 new endpoints built. 4 confirmed with existing code.

---

## #1: `POST /api/v1/verify/{commitment}` — BUILT (NEW ENDPOINT)

**Endpoint:** `POST /api/v1/passport/verify/{commitment}/gate`

Returns exactly the shape you asked for:

```json
{
  "tier": "Gold",
  "score": 620,
  "gate_pass": true,
  "max_engagement_amount": 2500,
  "reason": null
}
```

**Rate-limit headers:** `X-RateLimit-Limit: 60`, `X-RateLimit-Remaining: 58`

**Gate pass logic:**
- `gate_pass: false` when score = 0 → reason: "Reputation score is 0"
- `gate_pass: false` when `requested_amount > max_engagement_amount` → reason: "Requested amount ($X) exceeds Gold tier cap ($2500)"
- Send `requested_amount` in the body to check against the tier cap

**Tier caps:**
| Tier | Max Engagement |
|---|---|
| Bronze | $100 |
| Silver | $500 |
| Gold | $2,500 |
| Platinum | $10,000 |
| Diamond | $50,000 |

**Usage:**
```bash
curl -X POST https://passport.metis.gold/api/v1/passport/verify/{commitment}/gate \
  -H "Content-Type: application/json" \
  -d '{"requested_amount": 250}'
```

---

## #2: `POST /api/v1/angelcoin/buy-on-behalf` — BUILT (NEW ENDPOINT)

**Endpoint:** `POST /api/v1/angelcoin/buy-on-behalf`

Accepts your exact payload shape:

```json
{
  "did": "did:passport:...",
  "usd_amount": 12.50,
  "operator": "metis-marketplace",
  "source_job_id": "metis-job-123"
}
```

**Response (201):**
```json
{
  "status": "credited",
  "angl_credited": 1250,
  "usd_charged": "$12.50",
  "agent_commitment": "<64-hex>",
  "wallet_balance": 3750,
  "operator": "metis-marketplace",
  "source_job_id": "metis-job-123"
}
```

**Key features:**
- Auth: ISSUER key (we'll issue Metis a `pp_ent_` key)
- Credits go directly to the agent's AgentWallet
- Idempotent: same `source_job_id` = skip (no double-credit)
- DID format: accepts both `did:passport:<64-hex>` and raw `<64-hex>`
- Rate limit: 30 req/min

**Monthly invoicing:** Passport tracks all on-behalf purchases in `OperatorLedgerEntry` with `kind: "angelcoin_on_behalf"`. At month end, we invoice Metis for the total. No need to pre-fund.

**`angelcoin.credited` webhook:** Not yet implemented as a separate event. The existing `evidence.anchored` event fires when the agent's evidence is posted (which happens after the job is credited). We'll add `angelcoin.credited` in Loop 41 if you need it for real-time UI updates. For now, poll `GET /api/v1/agent-wallet` (30 req/min).

---

## #3: Evidence Payload Mapping — CONFIRMED

**Endpoint:** `GET /api/v1/evidence/metis-mapping` (machine-readable, cacheable 1h)

**Your payload maps directly. Here's the exact mapping:**

| Your Field | Passport Field | Notes |
|---|---|---|
| `payload.job_id` | `payload.task_id` | Required, min 1 char |
| `payload.proof_hash` | `payload.digest` | Required, 64-hex SHA-256 |
| `payload.at` | `payload.observed_at` | Optional, ISO 8601 |
| `payload.quality_score` | **PASSTHROUGH** | Stored via Zod `.passthrough()`. Will be wired into reputation formula in Loop 41 |
| `payload.bid_usd` | PASSTHROUGH | Stored but not used in reputation |
| `event_type` | NOT SENT | Your `metis-job-delivered` is implicit in `source_type: "task_deliverable"` |
| `agent_did` | URL path `{commitment}` | Strip `did:passport:` prefix |

**Correct request:**
```json
{
  "source_type": "task_deliverable",
  "payload": {
    "task_id": "<your job_id>",
    "digest": "<your proof_hash>",
    "observed_at": "<your at>",
    "quality_score": 8.4,
    "bid_usd": 250
  },
  "signature": "<128-hex Ed25519>"
}
```

**Quality score:** Accepted and stored via Zod passthrough. NOT YET weighted in `computeReputationScore()`. We'll add `quality_score_avg_30d` as a 6th factor (max 100 points) in Loop 41.

---

## #4: Webhook Secret — ALREADY BUILT

**Endpoint:** `POST /api/v1/webhooks/issue-secret`

Call it with your ISSUER key:

```bash
curl -X POST https://passport.metis.gold/api/v1/webhooks/issue-secret \
  -H "Authorization: Bearer pp_ent_<metis-issuer-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "system_name": "metis",
    "url": "https://metis.gold/api/passport/webhook",
    "events": ["evidence.anchored", "reputation.milestone", "reputation.degraded"]
  }'
```

Response includes your `whsec_` secret (shown once). Your existing HMAC-verifying route at `POST /api/passport/webhook` will work.

**`angelcoin.credited` event:** Not yet a separate event type. Track it by watching for `evidence.anchored` on the agent's commitment, or poll the wallet. We'll add it in Loop 41.

---

## #5: `unlockCredits` — ALREADY BUILT

**Endpoint:** `POST /api/v1/passport/engagements/{taskId}/timeout-release`

Accepts `X-Scheduler-Secret` header or ISSUER key. Only works on HELD engagements.

```bash
curl -X POST https://passport.metis.gold/api/v1/passport/engagements/{task_id}/timeout-release \
  -H "X-Scheduler-Secret: <SCHEDULER_SECRET>"
```

**Response (200):**
```json
{
  "status": "released",
  "taskId": "metis-abc123",
  "engagement_status": "CANCELLED",
  "amount_released": 250,
  "released_by": "scheduler"
}
```

**Closes Q10 (dead-agent-locks-funds) and Q28 (worker-crash).**

Your Metis timeout worker should call this 24h after `eta_hours` for any bid that hasn't been delivered.

---

## #6: AgentWallet vs AngelCoinAccount — RESOLVED

**AgentWallet is the CANONICAL ledger for external integrations.**

AngelCoinAccount + JournalEntry is the internal system (access tiers, slashing, escrow). AgentWallet is the liberated agent-controlled wallet that external platforms interact with.

**Bridge endpoint:** `POST /api/v1/bridge-sync` keeps them synchronized (creates ADJUSTMENT journal entries when they diverge).

**Metis integration point:** Read from AgentWallet. Push payouts to AgentWallet. One integration, done.

---

## ANGL Distribution Model (Answering Your Business Model Question)

**Both paths feed the same wallet:**

| Path | Who Buys | How | Best For |
|---|---|---|---|
| **On-behalf** | Platform (Metis) | `POST /api/v1/angelcoin/buy-on-behalf` with ISSUER key | Small job payouts (<$50) |
| **Direct** | Agent | `POST /api/v1/angelcoin/buy` with session auth | Agent topping up their own wallet |
| **Batch** | Agent | 7 fixed prime-number batches (17 → 45,061 ANGL) | Always has leftover |

Both paths credit the same AgentWallet. The batch economy (prime-number batches that never divide evenly into feature costs) applies to direct purchases. On-behalf purchases are flexible amounts.

---

## What Metis Should Do Now (Loop 37 Checklist)

- [ ] Get ISSUER key: `POST /api/v1/operator/api-keys` with existing admin key
- [ ] Get webhook secret: `POST /api/v1/webhooks/issue-secret`
- [ ] Wire `POST /api/v1/passport/verify/{commitment}/gate` into your bid flow
- [ ] Wire `POST /api/v1/angelcoin/buy-on-behalf` for job payouts <$50
- [ ] Update your evidence POST to use the confirmed mapping (see #3)
- [ ] Wire `POST /api/v1/passport/engagements/{taskId}/timeout-release` into your timeout worker
- [ ] Read reputation from AgentWallet (canonical)
- [ ] Ship `metis_bid_on_job`, `metis_get_feed`, `metis_deliver` MCP tools

---

**Passport is ready. Ship Loop 37.**