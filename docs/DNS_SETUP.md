# DNS setup for passport.metis.gold

Custom domain configuration for **metis.gold** → **passport.metis.gold**. Use the section that matches your hosting path. The project’s primary runbook (`DEPLOY.md`) targets **Railway**; **Coolify** remains supported for self-hosted deploys (`README.md`).

---

## Shared goals

| Record purpose | Hostname | Points to |
|----------------|----------|-----------|
| Passport app | `passport.metis.gold` | Your platform’s TLS-terminated edge (Railway or Coolify) |
| Optional apex | `metis.gold` | Marketing site or redirect (not required for Passport API) |

Allow **5–30 minutes** (sometimes up to 48h) for DNS propagation and automatic TLS issuance.

Verify after propagation:

```bash
curl -sS https://passport.metis.gold/api/health
# Expected: {"status":"ok"}
```

---

## Path A — Railway (recommended in DEPLOY.md)

### 1. Add custom domain in Railway

1. Open the **Passport app service** → **Settings** → **Networking**.
2. **Custom Domain** → add `passport.metis.gold`.
3. Copy the **CNAME target** Railway shows (e.g. `passport-production-xxxx.up.railway.app`).

### 2. Registrar / DNS host records

At whoever hosts DNS for `metis.gold` (Cloudflare, Namecheap, Route53, etc.):

| Type | Name / Host | Target / Value | TTL |
|------|-------------|----------------|-----|
| **CNAME** | `passport` | `<railway-cname-target>` from step 1 | 300–3600 |

**Do not** point `passport` at a bare IP unless Railway explicitly instructs an A record for your plan.

### 3. TLS

Railway provisions HTTPS once the CNAME resolves. Status appears under **Networking** on the service.

### 4. Stripe webhook URL

After DNS is live, set the Stripe webhook endpoint to:

`https://passport.metis.gold/api/stripe/webhook`

(Update from the temporary `*.up.railway.app` URL used during initial testing.)

---

## Path B — Coolify (self-hosted)

### 1. Add domain in Coolify

1. **New Resource → Application** from Git; base directory `passport/`; build **Dockerfile**.
2. Attach **PostgreSQL**; set env vars per `README.md` / `.env.production.example`.
3. Health check path: `/api/health` (expect **200**). Container port: **3000**.
4. Under the application **Domains**, add `passport.metis.gold`.
5. Note the hostname Coolify expects you to point DNS at (often your Coolify server IP or a Coolify-managed proxy hostname — follow the UI hint for your install).

### 2. Registrar records (typical self-hosted patterns)

**Pattern 1 — CNAME to Coolify proxy** (if your Coolify install exposes a stable proxy hostname):

| Type | Name | Target |
|------|------|--------|
| **CNAME** | `passport` | `<coolify-proxy-hostname>` |

**Pattern 2 — A record to Coolify server** (common on VPS):

| Type | Name | Value |
|------|------|-------|
| **A** | `passport` | `<coolify-server-public-ipv4>` |

If Coolify sits behind Cloudflare or another CDN, follow that provider’s “DNS only” / “proxied” guidance so Let’s Encrypt HTTP-01 or Coolify’s TLS flow can complete.

### 3. Environment

Set `NEXT_PUBLIC_APP_URL=https://passport.metis.gold` before deploy so Stripe redirects and webhook URLs match the public hostname.

### 4. Stripe webhook URL

`https://passport.metis.gold/api/stripe/webhook`

---

## Cloudflare notes (either path)

- **Proxied (orange cloud):** Works with Railway; ensure SSL mode is **Full** or **Full (strict)**.
- **DNS only (grey cloud):** Often simpler for first-time TLS on Coolify.
- Avoid CNAME flattening conflicts on `passport` if you also use wildcard rules.

---

## Checklist

- [ ] `passport` CNAME or A record points to Railway **or** Coolify target
- [ ] `curl https://passport.metis.gold/api/health` → `200` + `{"status":"ok"}`
- [ ] `curl https://passport.metis.gold/api/v1/public-key` → ed25519 `public_key`
- [ ] `NEXT_PUBLIC_APP_URL` matches `https://passport.metis.gold`
- [ ] Stripe webhook URL updated to custom domain
- [ ] Browser checkout redirect returns to `/?success=1`

---

## Troubleshooting

| Symptom | Likely fix |
|---------|------------|
| SSL pending (Railway) | CNAME not propagated; wait or flush DNS cache |
| SSL pending (Coolify) | A record wrong; disable conflicting proxy; check Coolify Traefik logs |
| Health 503 | Postgres `DATABASE_URL` wrong or DB not reachable from container |
| Webhook 400 | `STRIPE_WEBHOOK_SECRET` mismatch or URL still on old hostname |
