# Contributing to Passport

Thanks for helping build the open, commodity-backed identity + authenticity layer for AI agents.

## Get the code
```bash
git clone git@github.com:AngelBoyGo/passport.git
cd passport
npm install
# PostgreSQL is required (see README quick start)
npm run dev
```

## Development loop
- `npm test` — run the Vitest suite (1450+ tests; keep it green).
- `npx tsc --noEmit` — typecheck before opening a PR.
- `npx prisma generate` — after any `prisma/schema.prisma` change.
- Add a migration `prisma/migrations/<timestamp>_<name>/migration.sql` for schema changes.

## Conventions
- **Money ledger is sacred:** `AgentWallet.balance` holds whole ANGEL only. No test, smoke,
  tick, or executor path may mint money or write fractional/LP/state units there.
- **Atomicity:** every state transition uses a conditional `updateMany`
  (`{ where: { id, state, version }, data: { state, version: { increment: 1 } } }`)
  and aborts unless `count === 1`.
- **Idempotency:** every callback/settlement is deduped by a DB-unique composite key.
- Do not commit secrets. `.env` is gitignored; use `.env.example` for templates.

## PR checklist
- Typecheck + full test suite green.
- New behavior has Vitest coverage (mirror the phase under test).
- Migration SQL committed when schema changes.
- No secrets, no placeholder or demo-only stubs in runtime paths (tag any legitimate
  deterministic test tier with `@RAILLAB_MOCK`).

## Areas
- `src/lib/receipt` — signing, canonicalization, verification
- `src/lib/reserves` — RWA: monetary, oracle, PoR, escrow, transit, AMM
- `src/lib/digital-gateway` — mobile-money/USSD on-ramp
- `src/lib/raillab` — autonomous rail factory + settlement
- `sdk/` — TypeScript SDK (`@passport7/sdk`)
- `python/` — Python SDK