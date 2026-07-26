# Passport signing key management

Operator runbook for ed25519 receipt signing key **escrow**, **manual rotation**, and **verification**. This doc is additive ops guidance only — it does not change protocol, schema, routes, or receipt format.

Related docs:

- [`DEPLOY.md`](../DEPLOY.md) — Section 1 `SIGNING_PRIVATE_KEY` handoff and Railway variable setup
- [`disaster-recovery.md`](./disaster-recovery.md) — PostgreSQL backup/restore; coordinate key recovery with DB drills
- [`environment-manifest.md`](./environment-manifest.md) — production env var names (no secret values)
- [`pilot-support-runbook.md`](./pilot-support-runbook.md) — day-to-day pilot operations and contract checks

---

## Key model (pilot)

| Item | Detail |
|------|--------|
| **Algorithm** | ed25519 |
| **Secret env var** | `SIGNING_PRIVATE_KEY` — 32-byte seed, 64 hex chars |
| **Published verify key** | `GET /api/v1/public-key` returns `public_key` (64 hex) |
| **Scope** | Signs receipt payloads at issue time; verifiers fetch the live public key |

Passport holds **one active signing key** per environment. There is no in-app key history or multi-key JWKS in the pilot.

---

## Escrow (required before pilot)

Store the production `SIGNING_PRIVATE_KEY` outside Railway so you can recover after provider loss, accidental deletion, or operator turnover.

### What to escrow

1. **Primary seed** — the 64-hex `SIGNING_PRIVATE_KEY` value set in Railway Variables.
2. **Derivation note** — record that it is a raw ed25519 seed (not a PEM file).
3. **Environment label** — e.g. `passport.metis.gold production`, `staging`, `pilot-local`.
4. **Creation date** and **operator** who generated it.

### Where to store (pick one; human-operated)

| Store | Guidance |
|-------|----------|
| **Password manager** (1Password, Bitwarden org vault) | Preferred for solo/small-team pilots |
| **Encrypted offline backup** | GPG-encrypted file on removable media; test decrypt annually |
| **Cloud KMS envelope** | Wrap seed with KMS; keep unwrap policy separate from Railway access |

**Never:** commit the seed to git, paste into Slack/email, or duplicate into `.env` on shared machines without encryption.

### Escrow verification drill (quarterly)

1. Confirm you can **read** the escrowed value without modifying production.
2. Derive the public key locally (optional):
   ```powershell
   # From passport/ — uses SIGNING_PRIVATE_KEY from a disposable .env.local, not production paste in shell history
   npm run check:env
   ```
3. Compare derived public key to live endpoint (see [Verification](#verification-against-apiv1public-key) below).
4. Log drill date in your operator runbook.

---

## Manual rotation procedure

Rotate only during a **planned maintenance window**. Passport does not hot-swap keys automatically.

### Preconditions

- Escrow for the **current** key is confirmed (see above).
- Stakeholders accept [blast radius](#blast-radius-old-receipts) for receipts signed before rotation.
- Single-replica constraint holds — see [`environment-manifest.md`](./environment-manifest.md#single-replica-constraint-pilot).

### Steps

1. **Generate new seed** (once per rotation):
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. **Escrow the new seed** before touching production (same rules as initial handoff).
3. **Record old public key** for audit:
   ```powershell
   curl -sS https://passport.metis.gold/api/v1/public-key
   ```
   Save the `public_key` field and timestamp in your operator log.
4. **Update Railway Variables** — set `SIGNING_PRIVATE_KEY` to the new 64-hex seed on the Passport app service only. Do not change `INGESTION_COMMITMENT_SALT`.
5. **Redeploy** the app service (Railway redeploy or push-triggered deploy).
6. **Verify** new key is live (required — do not skip):
   ```powershell
   curl -sS https://passport.metis.gold/api/v1/public-key
   npm run check:contract -- --base-url https://passport.metis.gold
   ```
   Expected: HTTP 200, non-empty `public_key` **different** from step 3, contract check `PASS`.
7. **Issue a test receipt** on staging or disposable pilot DB, then:
   ```powershell
   npm run verify:receipt -- --payload <file> --signature <128-hex> --public-key <new-64-hex-from-step-6>
   ```
8. **Archive old seed** in escrow with label `retired-YYYY-MM-DD` — retain for forensic verify of old receipts.
9. **Announce** rotation window closed; downstream verifiers must refresh cached public keys (`Cache-Control: public, max-age=3600`).

### Rollback

If step 6 fails, restore the **previous** `SIGNING_PRIVATE_KEY` from escrow, redeploy, and re-run verification. Do not leave a partial rotation in place.

---

## Verification against `/api/v1/public-key`

The published verifying key must match the active `SIGNING_PRIVATE_KEY` in Railway.

### Quick check

```powershell
$base = "https://passport.metis.gold"
curl -sS "$base/api/v1/public-key"
```

Expected JSON shape:

```json
{
  "algorithm": "ed25519",
  "public_key": "<64-hex>",
  "note": "Open verify routine in src/lib/receipt/verify.ts — tamper-evident, not unforgeable."
}
```

### Contract check (recommended)

```powershell
npm run check:contract -- --base-url https://passport.metis.gold
```

The contract check includes `public_key` reachability. Run after every deploy and after any rotation.

### Local pilot

```powershell
$env:NEXT_PUBLIC_APP_URL = "http://localhost:3000"
npm run dev
# second terminal:
curl -sS http://localhost:3000/api/v1/public-key
npm run check:contract -- --base-url http://localhost:3000
```

---

## Blast radius (old receipts)

**Critical:** Rotating `SIGNING_PRIVATE_KEY` changes the live `/api/v1/public-key` response. Receipts signed **before** rotation verify only with the **retired** public key.

| Scenario | Effect |
|----------|--------|
| Receipt issued before rotation | Still valid if verifier uses the **old** 64-hex public key (from escrow log or pre-rotation `curl`) |
| Receipt issued after rotation | Verifies only with the **new** public key from `/api/v1/public-key` |
| Verifier caches old key | False "invalid signature" until cache expires (max ~1 hour per `Cache-Control`) or manual refresh |
| Lost old seed | **Old receipts become unverifiable** — there is no server-side key history in the pilot |

### Operator mitigations

1. **Retain retired keys** in escrow with retirement date (see rotation step 8).
2. **Document key epochs** in your operator log: `public_key`, active from/until timestamps.
3. **Notify integrators** (APF, HostHub, external agents) before rotation so they snapshot the current public key.
4. **Avoid unplanned rotation** — treat `SIGNING_PRIVATE_KEY` like a root credential; see [`DEPLOY.md`](../DEPLOY.md) Section 1.

There is no automatic re-signing of historical receipts in the pilot schema.

---

## Incident: suspected key compromise

1. **Rotate immediately** using the procedure above (skip the quarterly drill schedule).
2. **Preserve** the compromised seed label in escrow for forensics — do not delete.
3. Run [`disaster-recovery.md`](./disaster-recovery.md) checks if you suspect env exfiltration paired with DB access.
4. Follow [`pilot-support-runbook.md`](./pilot-support-runbook.md) triage for downstream contract failures.

---

## Blocked (requires human)

| Item | Owner | Status |
|------|-------|--------|
| Automated key rotation / JWKS multi-key | Engineering | Not in pilot scope |
| HSM-backed signing | Operator | Blocked — manual seed in Railway for pilot |
| Scheduled escrow drill calendar | Operator | Blocked — run manually per steps above |
