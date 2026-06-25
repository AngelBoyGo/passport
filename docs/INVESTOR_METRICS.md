# Investor metrics summary (template)

Honest snapshot of what Passport can measure **today** from code and infrastructure versus what requires **live production data** you control.

**Last updated:** template — fill after first production month.

---

## Executive summary (fill in)

| Metric | Value | Period | Source |
|--------|-------|--------|--------|
| MRR | _TBD_ | | Stripe Dashboard |
| Paying operators (Pro) | _TBD_ | | Postgres `Operator` where `tier = 'pro'` |
| Total operators | _TBD_ | | Postgres `Operator` count |
| Receipts issued (all time) | _TBD_ | | Postgres `Receipt` count |
| Receipts issued (30d) | _TBD_ | | Postgres `issuedAt` filter |
| Gate queries (30d) | _TBD_ | | **Not instrumented** — needs access logs or product analytics |
| API uptime | _TBD_ | | Railway / Coolify + `/api/health` synthetic checks |

---

## What we can measure now (with access)

### Revenue (Stripe — live or test)

| Metric | How | Caveat |
|--------|-----|--------|
| MRR | Sum active Pro subscriptions × price | Test mode ≠ real MRR |
| New Pro conversions | `checkout.session.completed` count | Webhook must be healthy |
| Churn | Canceled subscriptions in Stripe | Not wired to Passport DB automatically |
| ARPU | MRR / paying customers | Enterprise excluded until invoiced |

### Product usage (PostgreSQL)

```sql
-- Paying operators
SELECT COUNT(*) FROM "Operator" WHERE tier = 'pro';

-- Receipt volume (30 days)
SELECT COUNT(*) FROM "Receipt"
WHERE "issuedAt" >= NOW() - INTERVAL '30 days';

-- Receipts by domain (gate-relevant)
SELECT domain, COUNT(*) FROM "Receipt"
WHERE "issuedAt" >= NOW() - INTERVAL '30 days'
GROUP BY domain;

-- Error tranche distribution (reliability signal)
SELECT "errorTranche", COUNT(*) FROM "Receipt"
WHERE status != 'pending'
GROUP BY "errorTranche";

-- API keys minted
SELECT COUNT(*) FROM "ApiKey";
```

| Metric | Measurable? | Notes |
|--------|-------------|-------|
| Receipts per operator | Yes | Join `Receipt` → `Operator` |
| Credit consumption | Yes | `Operator.credits` + issue logs |
| Gate denial rate | Partial | Only if clients call gate; no server-side aggregate table |
| Verify page views | **No** | No analytics on `/verify/:id` unless added |
| Demo button usage | **No** | Disabled in production (`/api/dev/provision` → 404) |

### Infrastructure

| Metric | How |
|--------|-----|
| Deploy health | `GET /api/health` (DB-backed) |
| Webhook success rate | Stripe Dashboard → Webhook deliveries |
| Migration status | Container boot: `prisma migrate deploy` |

Run live audit when credentialed:

```bash
set PASSPORT_PRODUCTION_URL=https://passport.metis.gold
set PASSPORT_PRODUCTION_ADMIN_KEY=<Bearer API key>
set PASSPORT_PRODUCTION_OPERATOR_ID=op_cus_...
npx tsx scripts/live-production-audit.ts
```

---

## What we cannot measure without additional work

| Metric | Gap | Remediation |
|--------|-----|-------------|
| DAU / MAU | No session tracking | Add privacy-preserving analytics or API access logs |
| Gate query volume | Unauthenticated endpoint, no persistence | Log sampling or Cloudflare/Railway HTTP metrics |
| Time-to-first-receipt | Not computed | Batch job on `Operator.createdAt` vs first `Receipt` |
| NRR / expansion | No usage-based billing yet | Stripe metered billing + credits ledger export |
| Enterprise pipeline | Off-platform | CRM (Notion/HubSpot) manual |
| Fraud / abuse | Rate limits in-memory only | Redis + WAF rules |

---

## Suggested KPIs for investors (Phase 1)

### North-star

**Signed receipts finalized per week** — proves agents are producing verifiable behavioral evidence, not just signing up.

### Activation

| KPI | Definition | Target (example) |
|-----|------------|------------------|
| Time to first receipt | Checkout → first `POST /api/v1/receipts` 201 | < 24h |
| Pro provisioning success | Webhook 200 rate × operator row created | > 99% |

### Retention

| KPI | Definition | Data source |
|-----|------------|-------------|
| Receipt-active operators | Operators with ≥1 receipt in last 30d | Postgres |
| Credit utilization | % of monthly credits used before renewal | Postgres `credits` |

### Reliability narrative

| KPI | Definition | Data source |
|-----|------------|-------------|
| Error tranche mix | % `COMPUTE_TIMEOUT`, `LOGIC_DETECTION`, etc. | Postgres |
| SLA breach gate rate | % gate responses `SLA_BREACH_THRESHOLD_EXCEEDED` | **Needs logging** |

---

## Monthly reporting checklist

- [ ] Export Stripe MRR and new Pro subscribers
- [ ] Run SQL snapshots (operators, receipts, domains, tranches)
- [ ] Record `/api/health` uptime from host (Railway metrics or external ping)
- [ ] Stripe webhook failure count
- [ ] Run `npm test` in CI (regression guard — currently 65 tests)
- [ ] Optional: `live-production-audit.ts` with production env (genesis network proof)

---

## Honesty footer

- **Test-mode Stripe data must not be presented as production traction.**
- **Gate and verify endpoints are designed for integrators; usage is invisible without HTTP logs.**
- **Free tier operators may exist without Stripe revenue — segment by `tier`.**
- **Receipt counts ≠ GMV; they measure protocol adoption, not customer end-value.**
