# Enterprise pricing model

Aligned with the public tiers on the landing page (`src/app/page.tsx`) and Stripe Pro checkout (`STRIPE_PRICE_PRO` / $49/mo).

---

## Tier overview

| Tier | List price | Receipts / month | Signing | API | Support |
|------|------------|------------------|---------|-----|---------|
| **Free** | $0 | 100 | Shared infrastructure key | Verify-only emphasis | Community / docs |
| **Pro** | $49/mo | 10,000 | Verifier-held (shared infra) | Full issue + finalize + gate | Email |
| **Enterprise** | Custom | Contracted | Hardware signer (HSM / dedicated) | Full + SLA-backed | Named CSM, SSO |

Landing copy references: hardware signer, SSO + SLA, self-hostable verifier for Enterprise.

---

## Free ($0)

**Audience:** Evaluation, single-agent pilots, public verify integrations.

**Included**

- 100 receipts per calendar month (enforced via operator credits in DB)
- Public verify at `/verify/:receipt_id` and published ed25519 key at `/api/v1/public-key`
- Shared signing key on Passport-operated infrastructure

**Not included**

- Production SLA
- Dedicated signer
- SSO
- Self-hosted verifier image support

**Upgrade trigger:** Sustained receipt volume above 100/mo or need for API automation at scale → Pro.

---

## Pro ($49/mo)

**Audience:** Teams shipping agent workflows that need signed behavioral receipts.

**Included**

- 10,000 receipts per month (Stripe `checkout.session.completed` / renewal webhooks add credits per `DEPLOY.md`)
- Bearer API keys minted after successful checkout
- Gate queries (`POST /api/v1/gate/verify`) and receipt lifecycle APIs
- Verifier-held signing on Passport infrastructure

**Billing**

- Recurring Stripe Price (`STRIPE_PRICE_PRO`)
- Test mode: `sk_test_...` until live activation (Section 6 of `DEPLOY.md`)

**Overage (recommended commercial policy — not yet automated in Phase 1)**

| Band | Suggested price |
|------|-----------------|
| 10,001 – 50,000 | $0.008 / receipt |
| 50,001 – 250,000 | $0.005 / receipt |
| 250,001+ | Sales conversation |

Document overage in the Order Form; meter via operator `credits` consumption logs.

---

## Enterprise (custom)

**Audience:** Regulated workloads, multi-tenant platforms, air-gapped or self-hosted verify requirements.

**Typical annual contract bands (starting points for sales — not list prices)**

| Component | Indicative range |
|-----------|------------------|
| Platform fee | $36k – $120k / year |
| Included receipts | 250k – 2M / year (pooled) |
| Additional receipts | $0.003 – $0.006 / receipt |
| Hardware signer setup | $5k – $25k one-time |
| Self-hosted verifier | $15k – $40k / year maintenance |

**Enterprise package elements**

1. **Hardware signer** — Customer-controlled or Passport-managed HSM; keys not on shared multi-tenant verifier.
2. **SSO** — SAML/OIDC for operator dashboard and key management (Phase 2+; scoped in contract).
3. **SLA** — Uptime (e.g. 99.9% API), support response times, incident comms.
4. **Self-hostable verifier** — Docker image + runbook; customer operates verify/read path; optional write path federation.
5. **Domain-scoped gate policies** — Custom failure thresholds per `OperationalDomain` (contract addendum).
6. **Dedicated support** — Named technical contact, quarterly business reviews.

**Procurement artifacts**

- MSA + Order Form
- DPA (hash-only storage posture — no raw payloads in Passport DB)
- Security questionnaire responses (ed25519 open verify routine, Stripe for billing only)

---

## Comparison matrix (sales one-pager)

| Capability | Free | Pro | Enterprise |
|------------|------|-----|------------|
| Monthly receipts | 100 | 10,000 | Contract |
| API keys | Limited / dev | Yes | Yes + rotation SLA |
| Gate / SLA breach signals | Yes | Yes | Custom thresholds |
| Public verify | Yes | Yes | Yes (+ private verify option) |
| Signing key custody | Shared | Shared infra | Hardware / dedicated |
| SSO | — | — | Yes |
| Self-host verifier | — | — | Yes |
| Uptime SLA | — | Best effort | Contractual |

---

## Honest Phase 1 limits

- Overage billing is **not** automated in app code; Pro hard-stops or returns `402` when credits exhaust (verify in production before sales promises).
- Enterprise SSO and hardware signer are **roadmap / contract** items — confirm delivery phase before signing.
- All tiers: receipts are **tamper-evident**, not claimed unforgeable (landing page disclaimer).
