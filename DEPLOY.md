# Deploy Passport to passport.metis.gold (Railway + Stripe test mode)

This runbook gets Passport live at **https://passport.metis.gold** on Railway with managed Postgres and a working **Stripe test-mode** checkout. Real charges require Stripe account activation and a live-key env swap (Section 7) — no code changes.

## What this deploy includes

- Docker build from `passport/Dockerfile` (Prisma migrate on boot, Next.js standalone)
- PostgreSQL via Railway plugin
- Stripe Checkout that creates a **real** `cus_...` customer before opening a session (no fabricated `cus_pending_` ids)
- Test-mode webhooks that provision operator + API key + Pro credits

## Prerequisites (you)

- GitHub repo access (or `railway up` from `passport/`)
- Railway account
- Stripe account in **test mode**
- DNS access for `metis.gold`

---

## 1. SIGNING_PRIVATE_KEY handoff

Generate a 32-byte ed25519 seed (64 hex chars) **once**. Paste it only into Railway Variables — never commit to git.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Your deployment handoff includes a pre-generated key in the agent summary. Use that value for `SIGNING_PRIVATE_KEY` in Railway. If you rotate it later, all previously signed receipts become unverifiable unless you run a key-rotation plan.

---

## 2. Railway setup (click-by-click)

### 2.1 Create project and service

1. Go to [railway.app](https://railway.app) → **New Project**.
2. **Deploy from GitHub repo** (or use CLI: `cd passport && railway up`).
3. Open the service → **Settings** → **Root Directory** → set to **`passport`**.
4. **Settings** → **Build** → Builder: **Dockerfile** (uses `passport/Dockerfile`).
5. Confirm `railway.json` is picked up (health check `/api/health`).

### 2.2 Add PostgreSQL

1. In the project, click **+ New** → **Database** → **PostgreSQL**.
2. Open the Postgres service → **Connect** → copy **`DATABASE_URL`** (or use Railway variable reference `${{Postgres.DATABASE_URL}}` on the app service).

The container entrypoint runs `prisma migrate deploy` before `node server.js`.

### 2.3 Environment matrix (Phase 39)

One table, three columns of truth: `dev` = what `.env` sets locally, `staging` = pre-prod with
`ENFORCE_SIGNATURES=1`, `prod` = `NODE_ENV=production` at passport.metis.gold. **Never commit real
secret values anywhere.**

| Variable | dev | staging | prod | If missing → behavior (fail-closed policy) |
|---|---|---|---|---|
| `DATABASE_URL` | required | required | required | App cannot start; do not use SQLite in staging/prod |
| `SIGNING_PRIVATE_KEY` | required | required | required | Signed surfaces fail closed (never "OK" without it) |
| `SIGNING_PRIVATE_KEY_PREVIOUS` | optional | optional | optional | Rotation window only; remove after the window |
| `INGESTION_COMMITMENT_SALT` | required | required | required | Evidence ingestion refuses to derive commitments |
| `SESSION_SECRET` | dev fallback | required | required | Hard error outside dev (auth-service fails fast) |
| `NODE_ENV` | — | `production`-allowed† | `production` | Runtime fail-closed gates (`signaturesEnforced`) key off this |
| `ENFORCE_SIGNATURES` | optional | **`"1"` required** | optional ("1" harmless) | Without `1` and without prod NODE_ENV, signer-provenance checks skip (dev only) |
| `SOVEREIGN_KEY_ML/BF/NE` | optional | required | required | `/quorum/sign` → **401**; `/quorum/heartbeat` → **401** (no registered sovereign key) |
| `MILESTONE_VERIFIER_KEYS` | optional | required | required | `/fund/milestones` → **400** always (`No authorized milestone verifier keys configured`) |
| `EVIDENCE_SERVICE_AUTH_REQUIRED` | `true` | `true` | `true` | Evidence ingestion is unauthenticated otherwise (dev only) |
| `PASSPORT_SERVICE_TOKEN` | value | required | required | Inbound tenant evidence posts rejected when auth required |
| `EVIDENCE_BRIDGE_OPERATOR_ID` / `EVIDENCE_BRIDGE_AUTO_ENABLED` | optional | optional | optional | No auto custody receipts (feature dark, no failure) |
| `EVIDENCE_ENFORCEMENT_ENABLED` | `false` | `true` | `true` | Enforcement off = advisory only |
| `ENFORCE_ENROLLMENT_FOR_CREDITS` | `false` | `true` | `true` | Credits readable without enrollment otherwise |
| `NEXT_PUBLIC_APP_URL` | localhost | yes | `https://passport.metis.gold` | Stripe checkout/links point to wrong host |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `STRIPE_PRICE_PRO` | optional group | as needed | as needed | If any set: all three required (conditional group) |
| `SCHEDULER_SECRET` | optional | required | required | `/scheduler/tick`, `/brain/cycle`, heartbeat routes → **401** for cron triggers |
| `REVENUE_BRIDGE_SECRET` | optional | optional | required for partner rails | Non-ISSUER `/agent-revenue` calls → **503** `not_configured` |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | optional | optional | optional | Command Brain + factory brain run but every LLM decision → **NOOP** (fail closed) |
| `BRAIN_SCHEDULE` | optional | optional | optional | Brain cron defaults to every 10 min |
| `REVENUE_RUNNER_ENABLED` | optional | optional | **leave unset** | Default `0`; enabling in prod fabricates revenue — never enable outside dev/test |
| `UPSTASH_REDIS_REST_URL` / `TOKEN` | optional | optional | optional | Single-replica in-memory rate limit (correct but not shared) |
| `ADMIN_OPERATOR_EMAILS` | optional | optional | required for console | Dev/CEO console inaccessible (fail closed) |
| `ALLOW_DEV_PROVISION` | optional `"1"` | **unset** | **unset** | Hard 404 in prod regardless; only non-prod opt-in works |
| `NOTARY_ANCHOR_URL` | optional | optional | optional | External anchoring skipped (chain remains internally verifiable) |
| `ANGL_*` compliance vars | optional | required | required | Withdraw controls default to permissive variants — set them in staging+ |
| `SOVEREIGN_*` heartbeat cadence | — | — | — | Dead-man switch: states DARK after 72h silence (no env needed) |

† Staging runs `NODE_ENV=production`-equivalent fail-closed paths via `ENFORCE_SIGNATURES=1`; see §9.

Route-level darkness map (quick reference):

- Unset `SOVEREIGN_KEY_*` + prod → `POST /api/v1/reserves/quorum/sign` **401**, `POST /api/v1/reserves/quorum/heartbeat` **401**.
- Unset `MILESTONE_VERIFIER_KEYS` + prod → `POST /api/v1/reserves/fund/milestones` **always 400** (config error, fail closed).
- Unset `SIGNING_PRIVATE_KEY` → attestation/console/lighthouse report `degraded`, receipts issue **403**.
- Unset `REVENUE_BRIDGE_SECRET` → partner-sourced revenue rejected; ISSUER-key credits still work.

### 2.4 Deploy and verify (before custom domain)

1. **Deploy** the service.
2. Open the Railway-generated URL (e.g. `https://passport-production-xxxx.up.railway.app`).
3. Confirm health:
   ```bash
   curl -sS https://<railway-subdomain>/api/health
   ```
   Expected: `{"status":"ok"}` with HTTP **200**.
4. Confirm signing key is published:
   ```bash
   curl -sS https://<railway-subdomain>/api/v1/public-key
   ```
   Expected: JSON with ed25519 public key material.

---

## 3. Stripe test-mode config

**Ensure test mode is ON** (toggle in Stripe Dashboard).

### 3.1 Product and price

1. **Products** → **Add product** → name e.g. "Passport Pro".
2. Add a **recurring** price (e.g. **$49/month**).
3. Copy the **Price ID** (`price_...`) → set `STRIPE_PRICE_PRO` in Railway → redeploy.

### 3.2 Webhook

1. **Developers** → **Webhooks** → **Add endpoint**.
2. URL: `https://passport.metis.gold/api/stripe/webhook`
   - Until DNS is live, you can temporarily use the Railway subdomain URL for testing, then update to the custom domain.
3. Events to send:
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `customer.created`
4. Copy **Signing secret** (`whsec_...`) → set `STRIPE_WEBHOOK_SECRET` in Railway → redeploy.

### 3.3 Local webhook forwarding (optional)

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

---

## 4. DNS for passport.metis.gold

1. In Railway app service → **Settings** → **Networking** → **Custom Domain** → add `passport.metis.gold`.
2. Railway shows a **CNAME target** (e.g. `xxxx.up.railway.app`).
3. At your **metis.gold** registrar/DNS host, add:
   - **Type:** CNAME
   - **Name:** `passport`
   - **Target:** Railway CNAME value from step 2
4. Wait for DNS propagation and Railway TLS provisioning (often 5–30 minutes).
5. Confirm:
   ```bash
   curl -sS https://passport.metis.gold/api/health
   ```

---

## 5. End-to-end smoke test (test mode)

Run this **after** deploy, env vars, Stripe webhook, and DNS resolve. Use Stripe **test** card only — no real charge.

### 5.1 Browser checkout flow

1. Open **https://passport.metis.gold**.
2. Click the buy / checkout button (starts `POST /api/stripe/checkout`).
3. Complete Stripe Checkout with:
   - Card: `4242 4242 4242 4242`
   - Expiry: any future date
   - CVC: any 3 digits
   - ZIP: any valid value
4. Confirm redirect to `/?success=1`.

### 5.2 Stripe Dashboard checks

1. **Payments** / **Checkout** → session status **Complete**.
2. **Customers** → new customer with real `cus_...` id (not `cus_pending_`).
3. **Developers** → **Webhooks** → endpoint → recent deliveries **200** for `checkout.session.completed`.

### 5.3 Provisioning checks

Confirm the webhook created operator state (pick one method):

**Option A — Stripe + app logs**

- Railway deploy logs show no webhook 4xx/5xx errors after checkout.

**Option B — Database query (Railway Postgres)**

```sql
SELECT id, "stripeCustomerId", email, tier, credits FROM "Operator" ORDER BY "createdAt" DESC LIMIT 5;
SELECT COUNT(*) FROM "ApiKey";
```

Expected after first successful Pro checkout:

- Operator row with `tier = 'pro'`, credits increased (10,000 + initial free tier handling per webhook)
- At least one `ApiKey` row for that operator

**Option C — API smoke (local script, against production DB)**

Only if you have safe DB access; otherwise use Option B in Railway’s Postgres query UI.

### 5.4 Record results (honesty protocol)

Document for each run:

- Timestamp
- Checkout session ID (`cs_test_...`)
- Customer ID (`cus_...`)
- Webhook event ID (`evt_...`)
- HTTP status from `/api/health` and webhook delivery log
- What passed / what was **not** verified

---

## 6. Going live (when Stripe approves)

When Stripe enables live payments:

1. Switch Stripe Dashboard to **live mode**.
2. Create a **live** recurring Price → update `STRIPE_PRICE_PRO`.
3. Create a **live** webhook at `https://passport.metis.gold/api/stripe/webhook` → update `STRIPE_WEBHOOK_SECRET`.
4. Replace `STRIPE_SECRET_KEY` with `sk_live_...`.
5. Redeploy. **No code change.**

Then run one small real-card checkout to confirm live provisioning.

---

## 7. Verification performed by CI / local agent

| Check | Command | Expected |
|-------|---------|----------|
| Unit tests | `npm test` | All tests green (includes checkout customer-creation test) |
| Docker build | `docker build -t passport .` | Image builds successfully |

### What was NOT tested without your credentials

The following require **your** Railway, Stripe, and DNS setup — not runnable from the repo alone:

- Live deploy to Railway
- Custom domain TLS at passport.metis.gold
- Real Stripe Checkout redirect in browser
- Webhook delivery to production URL
- Postgres provisioning row inspection on Railway

Complete Sections 2–5 after deploy to obtain real execution proof.

---

## 8. ASMC-3 Sovereign Haven RWA & Governance Configuration

Passport includes full physical commodity Proof-of-Reserves, bilateral escrow clearing, and 2-of-3 trilateral sovereign governance.

### 8.1 Database Migrations
When the production container boots, the entrypoint automatically executes `prisma migrate deploy`, applying the four sovereign migrations:
1. `20260906000000_rwa_commodity_reserves_and_escrow`: `CommodityReserve`, `VaultBatch`, `AssayerCertification`, `CommodityEscrow`.
2. `20260906120000_add_sovereign_dividend_disbursement`: `SovereignDisbursement` (statutory revenue-sharing waterfall).
3. `20260907000000_add_artisanal_sourcing_and_intake`: `ArtisanalBuyingStation`, `OreIntakeReceipt` (orpailleurs field sourcing).
4. `20260907120000_add_sovereign_quorum_and_heartbeats`: `SovereignQuorumProposal`, `QuorumSignature`, `SovereignStateHeartbeat` (AES 2-of-3 governance).

### 8.2 Sovereign Keys Environment
In Railway Variables, set the Ed25519 64-hex public keys of the state ministries (defaults to verified benchmarks if unset):

| Variable | Value | Description |
|---|---|---|
| `SOVEREIGN_KEY_ML` | 64-hex Ed25519 public key | Mali Ministry of Mines / SOREM |
| `SOVEREIGN_KEY_BF` | 64-hex Ed25519 public key | Burkina Faso SONAMIG / Ministry |
| `SOVEREIGN_KEY_NE` | 64-hex Ed25519 public key | Niger SOPAMIN / Ministry |

### 8.3 Post-Deploy Sovereign Verification
After deployment, verify that the sovereign haven endpoints initialize:
```bash
# Verify Proof-of-Reserves & Merkle root:
curl -sS https://passport.metis.gold/api/v1/reserves/por

# Verify Dual-State Governor regime (SOLID vs GHOST):
curl -sS https://passport.metis.gold/api/v1/reserves/state

# Verify Sovereign Dividends waterfall:
curl -sS https://passport.metis.gold/api/v1/reserves/dividends

# Run closed-loop smoke test against staging/dev DB:
PASSPORT_SMOKE_ALLOW=1 npm run smoke:rwa
```

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Checkout 500 "STRIPE_PRICE_PRO not configured" | Missing or wrong `STRIPE_PRICE_PRO` |
| Stripe rejects customer id | Old code using `cus_pending_` — ensure latest deploy |
| Webhook 400/401 | Wrong `STRIPE_WEBHOOK_SECRET` or URL mismatch |
| `/api/health` 503 | `DATABASE_URL` wrong or Postgres not reachable |
| Domain SSL pending | DNS CNAME not pointing to Railway target yet |

---

## Quick reference

- Health: `GET /api/health`
- Public key: `GET /api/v1/public-key`
- Checkout: `POST /api/stripe/checkout` `{ "email": "you@example.com" }`
- Webhook: `POST /api/stripe/webhook` (Stripe-signed)

---

## 9. Staging validation runbook (human-executed, Phase 39)

Purpose: prove, **before prod**, that the fail-closed hardening works under an enforced
environment and that the deploy tooling (Docker/SSH via `deploy.yml`) lands cleanly.

Staging env deltas (everything prod-like, except pointers):

- `NODE_ENV=production`
- `ENFORCE_SIGNATURES=1`
- `EVIDENCE_SERVICE_AUTH_REQUIRED=true`
- `ALLOW_DEV_PROVISION` **unset**
- Real `SOVEREIGN_KEY_ML/BF/NE` test-keypairs (never the git benchmark keys)
- Real `MILESTONE_VERIFIER_KEYS` (verifier test key)
- `DATABASE_URL` pointing at managed staging Postgres (migrations, not `db push`)

### 9.1 Checklist

1. Deploy via the normal flow (Railway variables per §2.3, or the existing
   `deploy.yml` docker pipeline).
2. `curl -sS https://<staging-host>/api/health` → `{"status":"ok"}`.
3. `npm run doctor:passport` (against staging `DATABASE_URL`) → all checks green.
4. `npm run premortem` → no monetary invariant violations.
5. **Signer-provenance penetration drill** — the key Phase 39 invariant:

```bash
# Forge an unsigned/invalid sovereign vote: 128-hex zero signature.
SIG=$(printf '0%.0s' {1..128})
curl -s -X POST https://<staging-host>/api/v1/reserves/quorum/sign \
  -H "Content-Type: application/json" \
  -d "{\"proposal_id\":\"PROP-STAGING-1\",\"signer_state\":\"ML\",\"signature\":\"$SIG\"}"
```

   Expected: HTTP **401**, and the service logs emit an
   `{"event":"signature_provenance_rejected","outcome":"rejected","http_status":401,"reason_code":"signature_mismatch"|...}`
   line within seconds of the request.
6. Unenrolled swarm key probe: `POST /api/v1/swarm/bounties` with a caller-supplied
   `public_key` only (no enrollment row) → rejected under `ENFORCE_SIGNATURES=1`.
7. Confirm the read-only surfaces stay open: `/verify/[commitment]` gate returns
   `verified: true` for an enrolled agent (fail-closed must not break happy paths).
8. Record results in the honesty protocol table (§5.4 style) — include the log excerpt.

### 9.2 Non-goals during staging

- Never enable `REVENUE_RUNNER_ENABLED=1` on staging data that prod will inherit.
- Never post real POLITICAL/PoR artifacts; use dedicated staging commitments.
- Never run `prisma db push` — staging DB must be migrated-only (`migrate deploy`), matching CI.
