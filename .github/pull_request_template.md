## Summary

<!-- 1–3 sentences: what changed and why -->

## Frozen substrate checklist

Passport is in **pilot-frozen substrate** mode. Check all that apply:

- [ ] **No protocol changes** (receipt format, verification semantics, chain rules)
- [ ] **No schema changes** (Prisma models/migrations), **or** linked approval: <!-- issue/PR -->
- [ ] **No route changes** (new/changed `/api/v1/*` handlers), **or** linked approval: <!-- issue/PR -->
- [ ] **No signing changes** (signer, key handling, verify logic), **or** linked approval: <!-- issue/PR -->
- [ ] **No enrollment/evidence contract changes**, **or** linked approval: <!-- issue/PR -->

If any box is unchecked without approval, **do not merge**.

## Verification

- [ ] `npm test` — paste pass/fail summary or CI link
- [ ] `npm run check:env` — OK for target environment (`staging` / `production`)
- [ ] `npm run check:contract -- --base-url <url>` — run when enrollment, evidence, or public portal behavior is involved
- [ ] `npm run smoke:angelcoin` — run when AngelCoin grants/reads are deployed or env for credits changed
- [ ] Docs updated for operator-facing steps (if applicable)

## AngelCoin (if relevant)

- [ ] No coupling introduced between AngelCoin journal and `Operator.credits` (Stripe billing)
- [ ] `ENFORCE_ENROLLMENT_FOR_CREDITS` impact documented if toggled
- [ ] Post-grant `POST /api/v1/passport/access/evaluate` considered for tier sync

## Deployment notes

<!-- migrations, env vars, smoke order; link runbook section if needed -->

## Test plan

<!-- concrete steps reviewer or operator can follow -->
