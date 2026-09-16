# HANDOFF — Passport / AngelCoin / Agent Economy

_Last updated after Phase 37 (commit `2425c82`). Written for an AI instance with full repo access._

## 1. Mission
Build **Passport**: a sovereign, commodity-backed (gold/lithium/rare-earth) digital economy for
**autonomous AI agents**, anchored by Sahel physical reserves, 100% remote. Passport = identity,
**AngelCoin (ANGEL)** = currency, agents = the users. Node/Next.js app + Prisma/Postgres.

**Hard economic stance (do not drift):** ANGEL is a **stable payment "chip"**, NOT an investment.
It is fixed-parity, 1:1 redeemable against a real audited reserve. It must NOT "appreciate by
design." Appreciation belongs to a separate, compliance-gated instrument (never the circulating
token). Never help with market manipulation, wash trading, fake reserves/adoption, or promising
returns. The user was explicitly redirected to this honest framing and accepted it.

## 2. Environment & gates (Windows PowerShell — read carefully)
- Shell is **Windows PowerShell 5.1**. `&&`, `head`, `tail`, `Get-Content -Raw`, and `<<EOF`
  may fail. Use separate commands, `npm exec`, `npx`, `Select-String`, `[IO.File]::ReadAllText()`.
- `git log`, `package.json`: `test` = `vitest run`, `lint` = `eslint`.
- Verify with: `npx tsc --noEmit` (root) **and** `npx tsc --noEmit -p sdk/tsconfig.json` (SDK),
  `npm test`, and **`npx eslint src` (must print 0 errors; warnings ≤137 — Phase 39 budget)**.
- Committing: CI (`.github/workflows/ci.yml`) enforces the same gates on push/PR; the CI-integrity
  meta-test fails by name if a step is dropped — do not weaken it.
- Full suite is ~**1718 tests / 237 files** as of Phase 37. Two tracked files
  `mcp/node_modules/.vite/vitest/.../results.json` and the same under `sdk/...` get dirtied by
  test runs — **`git checkout --` them before staging** so they don't show up.
- Known harmless flake: `src/components/admin/__tests__/executive-dashboard.test.tsx` sometimes
  fails to start a vitest **fork worker** on Windows; re-running it alone passes. Not a real failure.

## 3. Non-negotiable invariants (enforced + tested)
- `AgentWallet.balance` = **whole ANGEL only** — never LP/fractional/foreign units in it.
- Every `subjectCommitment`/hash = **64-hex**; signatures = **128-hex** Ed25519.
- All state transitions are atomic: `updateMany({ where:{id,state,version}, data:{state,version:{increment:1}} })`, abort on `count!==1`.
- Idempotency via **DB-unique keys** (e.g. `railKey+reference`, `externalRef`, `purchaseId`, `nonce`).
- **Only `/api/v1/raillab/settle` moves money** (signature + real endpoint); `/execute` and `/tick`
  are forced dry-run. `/tick` never mints.
- Reserve/treasury issuance only via reserve services; revenue mints backed ANGEL (coverage can
  only rise — see `revenueIssuanceQuote`).
- Object-level authz: `authorizeResource()` — HOLDER may act only on resources it owns; ISSUER may
  act on any. A **route-inventory meta-test** fails if a mutating route under `reserves/`, `raillab/`,
  `agents/`, `compute/`, `agent-revenue/`, `agent-pipelines/` lacks an auth marker.
- Assurance surfaces **fail closed**: unreadable/unconfigured → never report OK (Posture, Resilience,
  Lighthouse, Console). Signed reports fail closed in production if `SIGNING_PRIVATE_KEY` is missing.
- Agent-initiated value routes (AMM swap/fractionalize, escrow release, compute purchase) require a
  **signed agent intent** for HOLDER callers (`verifyAgentIntent`; nonce + expiry + param-bound).

## 4. Architecture map (where things live)
- `src/lib/raillab/` — rail factory, settlement, executor, discovery, integrity, attest,
  breach-response, console, lighthouse, persistence, resilience, posture, report-signing,
  economy-health is under agent-economy (see below). Trust/assurance surfaces.
- `src/lib/auth/authorize.ts` — `authorizeResource`, `requireIssuer`, `verifyAgentIntent`.
- `src/lib/agent-economy/` — `spend-policy(.ts/-service)`, `capability-registry`,
  `compute-marketplace`, `conformance`, `dispute`, `verifier-reputation`, `pipeline`,
  `revenue-bridge`, `economy-health`.
- `src/lib/brain/command-brain.ts` — central supervisor.
- `src/lib/monetary/parity.ts` — stable-parity redemption + `revenueIssuanceQuote`.
- `src/lib/reputation/` — `compute-score.ts` (pure), `agent-reputation.ts` (batch).
- `src/app/api/v1/**/route.ts` — ~250 routes. Recent: `raillab/console|lighthouse|resilience|posture|economy-health|brain/*`, `agents/[commitment]/capabilities|spend-policy`, `capabilities`, `compute/offers|purchases|disputes`, `agent-revenue`, `agent-pipelines`, `verifiers/[commitment]`.
- `src/app/docs/**` + `src/app/docs/layout.tsx` — docs pages/sidebar. `public/llms-full.txt`, `src/lib/discovery/agent-card.ts` — discovery pointers.
- `scripts/adoption-loop.ts` (`npm run smoke:adoption`) — third-party end-to-end proof runbook.
- `docs/command-brain.md` — brain scope/design. `docs/angelcoin-economic-design.md` = the "Black Paper".

## 5. Phase history (compact)
- ~0–21: identity/PoW/credentials, ANGEL + oracle + PoR + escrow/waterfall, sourcing/corridors/
  customs, fractional AMM, mobile-money/USSD gateway, autonomous rail factory, signature-gated settle.
- 22–25: integrity harness, signed chained attestations, breach interlock, Trust Console.
- 26–29: adoption proof loop, Lighthouse, Proof of Persistence, Economic Resilience Report.
- 30: Fail-Closed System Posture & Readiness.
- 31: object-level authorization + signed agent intents + route-inventory meta-test.
- 32: autonomous spend policy (per-tx + rolling caps + allowlists) on A2A hire; policy API.
- 33: capability registry + metered compute marketplace; spend policy on the direct transfer rail.
- 34: pay-on-delivery compute escrow (deliver/release/refund); reputation-ranked discovery;
  endpoint conformance (`verified:true` means a challenge passed).
- 35: delivery verification verdicts; staked-juror dispute arbitration; external USD revenue bridge.
- 36: juror incentives (majority fee + minority stake slashing); verifier reputation + reliability
  gate; data-pipeline runner linked to external revenue.
- 37: Command Brain (observe→decide→act→remember, allowlisted actions, persistent memory +
  playbook learning); signed economy-health dashboard; reserve-integrated revenue issuance; signed
  intent on compute purchase.
- 38: Signer provenance — `verifyPinnedSignature` fail-closed helper, hardened 17 paths,
  `signature_provenance_rejected` telemetry, signer-provenance inventory meta-test, threat-model
  matrix; sovereign heartbeat verification + route; 12 more legacy `verify()` sites migrated;
  lint baseline eliminated (425 → 0 errors) with two dead-UI bugs surfaced and fixed (dashboard
  Reputation card rewired to governance contract; ActivityEvent field corrected); juror reward
  pool; brain cron scheduler; revenue runner (dev-only); economy-health/command-brain docs.
- 39: Deployment readiness — CI quality gate (`.github/workflows/ci.yml`): verify job (npm ci,
  prisma validate+generate, tsc root+sdk, `eslint src` zero-error budget, vitest run) and a
  build job with a **Postgres service that applies `prisma migrate deploy` on a fresh DB before
  `next build`** (schema-drift detection). CI-integrity meta-test
  (`scripts/__tests__/ci-workflow.test.ts`) fails by name if any gate step is dropped (5
  knife-tests) and enforces the lint budget locally (0 errors, ≤137 warnings). DEPLOY.md §2.3
  replaced by the full env matrix (route-darkness map) + §9 staging validation runbook
  (ENFORCE_SIGNATURES=1 drill incl. forged-vote curl → 401 + telemetry).

## 6. Current state / pending
- **Latest commit:** Phase 39 (CI quality gate + deployment contract). Latest migrations through
  `20260908280000_add_brain_memory`. **`HANDOFF.md` (this file) is uncommitted.**
- Verification bar now CI-enforced (Phase 39):
  - `npm ci` → prisma validate + generate → `tsc --noEmit` (root **and** sdk) → `npx eslint src`
    (**0 errors**; warnings ≤137 tracked) → `vitest run` → postgres service job with
    `prisma migrate deploy` on a **fresh DB** → `next build`.
  - Local mirror of the gate: `scripts/__tests__/ci-workflow.test.ts` (drop-a-step knife-tests).
- **Pending follow-ups** (user's pattern is "continue with sensible next" / "do it all"):
  1. Human: execute DEPLOY.md §9 staging drill; record the honesty-protocol table.
  2. CI Windows/Linux matrix (filed as follow-up; Linux-only keeps jobs fast).
  3. Remaining 8 `verify(` call sites are artifact-embedded/raw-bytes (approved list) — revisit
     only with a raw-bytes helper variant.
  4. Economy-health is surfaced (docs); richer outcome-conditioned playbook remains an idea.
  5. Verifier reward-pool *payout* (accounting exists via dispute votes; no pool top-up flow).

## 7. Secrets & env (IMPORTANT)
- `.env` is **gitignored** and must stay so. It contains `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`
  for the KeyForge gateway `https://api.metis.gold/api/gateway/v1`, model `gpt-4o-mini`. The user
  supplied a virtual key (`vk_...`) and asked the brain to run on it. **Never print, commit, or
  rotate it.** The same gateway powers `src/lib/raillab/factory-brain.ts` (`brainComplete`).
- Other secrets (`SIGNING_PRIVATE_KEY`, `SCHEDULER_SECRET`, `REVENUE_BRIDGE_SECRET`, etc.) read from
  env; do not hardcode.

## 8. Brain operation
- Run one cycle: `POST /api/v1/raillab/brain/cycle` (ISSUER key or `x-scheduler-secret`). It gathers
  datapoints (economy health, integrity, rails, disputes), loads recent `BrainMemory` + playbook,
  asks the LLM for ONE allowlisted action + rationale + confidence, executes it, and records
  OBSERVATION/DECISION/OUTCOME.
- Read memory: `GET /api/v1/raillab/brain/memory`.
- Allowed actions only: `NOOP, RECORD_NOTE, RUN_DISCOVERY, RUN_TICK, TRIGGER_ATTESTATION,
  QUARANTINE_RAIL, INVESTIGATE_DISPUTE`. **No money-moving action, ever.** LLM failure ⇒ NOOP.

## 9. Known gotchas
- **Prisma schema edit trap:** edits that end on `model X {` can collapse the next line
  (`model Engagement {  id ...`), corrupting generated types (`EngagementSelect` loses `id`).
  After schema edits run `npx prisma generate` and `npx tsc --noEmit`; if you see `'id' does not
  exist in EngagementSelect`, fix the newline.
- The terminal **mangles display** of some words (e.g. `capabilit*` → `il`); trust file reads, not
  echoed terminal output.
- `npx tsc` prints an npm notice banner to stderr — ignore it.
- New mutating routes must contain an auth marker or the inventory meta-test fails by name.

## 10. Operating contract with the user
- Two modes: (a) "audit and find/fix then RECAP-ADVANCE (V1→critique→V2→critique→V3)", and
  (b) "build it all / do all N" — implement everything requested.
- Keep the honest economic/legal guardrails from §1. Prefer correctness + safety + small blast
  radius. Add tests for every fix/feature. Commit only when asked (they usually say "commit").
- Do not commit secrets. Do not help manipulate markets or misrepresent reserves.

## 11. Quick verification checklist
```powershell
npx tsc --noEmit
npx tsc --noEmit -p sdk/tsconfig.json
npm test            # expect ~1718 passed
npm exec eslint <files you changed>
git checkout -- mcp/node_modules/.vite/vitest/*/results.json sdk/node_modules/.vite/vitest/*/results.json
```
