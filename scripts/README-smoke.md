# Adoption Proof Loop (Phase 26)

The "run it yourself" proof that the whole passport palette works end-to-end against a **live
deployment**, in a machine-readable, repeatable, third-party-runnable way. It converts
*provable* → *adopted*: instead of trusting our claims, you run one script and let it verify
enrollment, evidence, receipts, signature-gated settlement, the trust console, the
attestation chain, and tamper-rejection — then read the JSON report.

## What it proves

Against a running deployment (`BASE_URL`, `API_KEY` — an ISSUER key — and optionally
`SCHEDULER_SECRET`):

| Step | What it exercises | Pass condition |
| ---- | ----------------- | -------------- |
| enroll | Agent PoW challenge + Ed25519 proof-of-possession | 64-hex subject commitment returned |
| evidence | Signed evidence ingestion bound to the agent key | event commitment hash returned |
| receipt | Issue + finalize a receipt; offline verify its Ed25519 | `public-manifest` signature **verifies** offline |
| provision_rail | ISSUER provisions a caller-owned canary rail | rail becomes ENABLED (idempotent by `rail_key`) |
| settle | Signature-gated `/settle` webhook | status is exactly `SETTLED` |
| console | Trust Console aggregate | severity ∈ {OK, WARNING} |
| attestation | Latest integrity attestation | hash **and** Ed25519 signature verify offline (stored public key) |
| tamper | One-byte flip of the attestation hash | `/attestations/verify` returns false |

Exit code is `0` **iff** every step passed AND the attestation verified AND the tamper was
rejected — declared exactly in `report.ok`.

## Run it

```bash
npm install   # once

BASE_URL=https://passport.example.com \
API_KEY=pp_issuer_yOURISSUERKEY \
SCHEDULER_SECRET=... \
npm run smoke:adoption
```

With the `--cron` flag, one discovery scan and one health tick run **before** the loop, so the
same harness also proves the live LLM brain + rail-factory cadence between runs:

```bash
npm run smoke:adoption -- --cron
```

The canary rail is **dry-run safe by construction**: it is provisioned without any sandbox
endpoint, so `canExecuteLive` is false and the `/settle` it drives never moves real money.
Every reference is run-tagged (`adopt-<runid>-…`), so repeated runs never mint duplicates.

## The report

```json
{
  "ok": true,
  "version": "1.0.0",
  "run_id": "20260911123000-a1b2c3d4",
  "steps": [{ "step": "enroll", "ok": true, "detail": "agent enrolled (commitment abc…)" }],
  "enroll_commitment": "<64-hex>",
  "evidence_event_hash": "<64-hex>",
  "receipt_id": "rec_...",
  "receipt_manifest_verified": true,
  "rail_key": "adopt-20260911123000-a1b2c3d4",
  "settle_status": "SETTLED",
  "settle_live": false,
  "console_severity": "OK",
  "attestation_verified": true,
  "attestation_chain_ok": true,
  "tamper_rejected": true,
  "tamper_flipped_hash": "<64-hex, flipped>"
}
```

## Run it yourself (third parties)

Any operator/auditor with an ISSUER key against a deployment can reproduce this exact proof.
The attestation step is fully **offline**: the script recomputes the canonical hash, re-derives
nothing from server state, and verifies the Ed25519 signature using the public key stored on
the attestation row.

- Code: `scripts/adoption-loop.ts` (self-contained: `@noble/ed25519` + `fetch`, no server imports)
- Pairs with: `GET /docs/trust-console`, `GET /llms.txt`, `GET /.well-known/agent.json`