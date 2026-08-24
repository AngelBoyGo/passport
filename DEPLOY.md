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

### 2.3 Environment variables

On the **Passport app service** → **Variables**, set:

| Variable | Value |
|----------|--------|
| `DATABASE_URL` | From Postgres plugin (internal URL is fine) |
| `SIGNING_PRIVATE_KEY` | 64-hex from Section 1 (handoff) |
| `SIGNING_PRIVATE_KEY_PREVIOUS` | Optional: previous 64-hex signing key during a rotation window. Enables a transition period where artifacts signed under the old key still verify; persisted into the key transparency log. Remove after the rotation window. |
| `INGESTION_COMMITMENT_SALT` | Long random string (same value across all app instances; never commit to git) |
| `EVIDENCE_BRIDGE_OPERATOR_ID` | Optional: dedicated minter operator id for the evidence→receipt auto-bridge (its credit balance funds receipt minting) |
| `EVIDENCE_BRIDGE_AUTO_ENABLED` | Optional (`true`): auto-mint a signed custody receipt for every accepted enrolled-evidence event |
| `NOTARY_ANCHOR_URL` | Optional: independent append-only notary endpoint (e.g. a hardened audit sink). When set, each `/api/v1/receipts/checkpoints/latest` call publishes the signed Merkle chain head to it for external anchoring |
| `SESSION_SECRET` | 64-hex random string (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `UPSTASH_REDIS_REST_URL` | Optional: Upstash Redis REST URL for multi-replica distributed rate-limiting |
| `UPSTASH_REDIS_REST_TOKEN` | Optional: Upstash Redis REST token |
| `NEXT_PUBLIC_APP_URL` | `https://passport.metis.gold` |
| `STRIPE_SECRET_KEY` | `sk_test_...` (rotate if previously exposed) |
| `STRIPE_PRICE_PRO` | `price_...` from Section 3 |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` from Section 3 |
| `NODE_ENV` | `production` |

Reference: `.env.production.example`

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
