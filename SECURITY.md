# Security Policy

## Reporting a vulnerability

The Passport core prioritizes the correctness of its money ledger above all else. If you
find a way to mint ANGEL, double-settle a callback, drain a liquidity pool, or bypass an
authentication check, please report it privately first.

**Contact:** open a private security advisory in the GitHub repo
(https://github.com/AngelBoyGo/passport/security/advisories/new) or email the maintainer
via the repository's security contact. Please do **not** open a public issue for
money- or identity-critical bugs.

We aim to acknowledge within 48h and to ship a fix within 14 days depending on severity.

## Supported versions

| Surface | Supported |
| --- | --- |
| Core protocol (receipts, evidence, gate) | Yes |
| Sovereign Haven RWA (escrow, reserves, AMM, transit, customs) | Yes |
| Digital Money Gateway (mobile-money, USSD) | Yes |
| Rail Factory (raillab) | Yes |
| `@passport7/sdk`, `passport-sdk` | Yes |

Use the latest tagged `main`; releases drive `prisma migrate deploy` automatically.

## Invariants that are treated as critical

1. `AgentWallet.balance` holds whole ANGEL only — never LP/fractional/foreign units.
2. No test, smoke, factory-tick, or executor path may mint money or book the treasury.
   Live execution requires a verified signature **and** a real live endpoint.
3. Every state transition and settlement is idempotent by a DB-unique key
   (`@@unique` / `@@unique([...])`) and every money-touching mutation is a conditional,
   atomic `updateMany` with a `version` guard; a `count !== 1` aborts the op.
4. STATE/treasury issuance and redemption occur only through the reserve services —
   never through a settlement webhook or the rail executor.
5. Ed25519 verification is enforced for provider callbacks and settlements in
   `NODE_ENV=production`; the SDK is "verifier write-only" (only the API signs).

## Scope

- In scope: the codebase under this repository (`src/`, `sdk/`, `python/`,
  `scripts/`, `examples/`), Prisma schema + migrations, and the deployments it produces.
- Out of scope: third-party providers (Stripe, mobile-money operators, commodity feeds),
  host OS hardening, and infrastructure credentials.

## Disclosure

We practice coordinated disclosure. After a fix ships, we credit reporters in release notes
(unless anonymity is requested).