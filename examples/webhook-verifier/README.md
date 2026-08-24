# Known-Answer Webhook Verifier

A committed, **known-answer** fixture + a tiny runnable verifier that a downstream
consumer can execute to mechanically confirm Passport's webhook signature rule
works — no server, no database, no guesswork.

## Why this exists

The webhook receiver contract is: each delivery body
`{ event, data, timestamp }` is signed as

```
X-Passport-Signature = sha256-hex( JSON.stringify(body) + secret )
```

with the per-subscription `whsec_...` secret returned at registration. This
example lets anyone **run** the published verifier against a fixed, committed
tuple (payload + secret + signature) and see it pass — and a tampered variant
fail.

## Files

- `fixtures/payload.json` — a representative `reputation.degraded` delivery body.
- `fixtures/secret.txt` — **test-only** secret (never use in production).
- `fixtures/signature.txt` — the committed **known-answer** signature for
  (payload, secret), computed with the real `computeWebhookSignature`.
- `verify.ts` — the runnable verifier. Imports the SAME public utility
  (`verifyWebhookSignature`) from `src/lib/webhooks/webhook-service`, so it can
  never drift from what a real receiver uses.
- `__tests__/webhook-verifier.test.ts` — Vitest coverage (honest fixture, valid
  PASS, tampered FAIL, wrong-secret FAIL, exit codes).

## Run it

```bash
# From the repo root
npx tsx examples/webhook-verifier/verify.ts \
  --payload   examples/webhook-verifier/fixtures/payload.json \
  --signature examples/webhook-verifier/fixtures/signature.txt \
  --secret    examples/webhook-verifier/fixtures/secret.txt
# Expected: PASS: signature matches   (exit 0)

# Tampered payload → FAIL (exit 1)
# Wrong secret     → FAIL (exit 1)
```

## Re-verify with your own payload/secret/signature

```bash
npx tsx examples/webhook-verifier/verify.ts \
  --payload <your-payload.json> \
  --signature <your-signature.txt> \
  --secret <your-whsec-secret> \
  [--maxAgeSec 300]
```

> The fixtures in this repo are for **known-answer testing only**. The committed
> `secret.txt` and `signature.txt` must never be used for real webhook traffic.