# Stage 1 Evidence Review

Date: 2026-09-05. Decision: **NO-GO for real-value reserve issuance or deployment
based on the handoff. GO for local accounting remediation and a read-only,
explicitly non-backed prototype.**

This assessment supplements, rather than overwrites, the earlier untracked
`sahel-resource-haven-stage1.md`. Its statement that mitigations were integrated
is not supported by an implementation or execution record. Proposed sovereign
agreements, custody arrangements, hardware and statutory authority are not
established by this repository. No production host was contacted in this review.

## Execution Evidence

Repository snapshot: `c2cf5590cdaeee9eb53d74545670ac1fe8ea6288`.
Tool: `rhein1/agoragentic-premortem-golden-loop`, revision
`774a4163186f04ff45a3db62fc0d3418a5dafa4c`, package version `0.1.7`.
Method: local static release audit plus a separate prospective-hindsight review
grounded in source and synthetic financial scenarios. The CLI's narrative is
template/heuristic output, not independent expert or multi-model consensus.

| Check actually run | Result | Meaning |
|---|---|---|
| `npm run premortem -- "C:\Users\izzyb\AppData\Local\Temp\opencode\passport-premortem-tool"` | Exit 1; score 56; 2 tool blockers; 0 warnings in premortem summary | Missing recognized license file and potential secret patterns. This score is not a probability of failure or a solvency score. |
| Upstream Golden Loop | 4 pass, 1 warn, 1 fail, 3 skip | Documentation/install/discovery checks are not working settlement evidence. No runtime/network/test probes were enabled in the tool. |
| `npm run premortem:monetary` | Exit 1; 1 scenario passes, 2 fail | Current pricing math does not enforce aggregate redemption coverage. |
| `npm test -- src/lib/angelcoin/__tests__/monetary.test.ts src/lib/bridge/__tests__/bridge-adapter.test.ts src/lib/release/tests/angelcoin-closed-loop.test.ts src/lib/admin/admin-auth.test.ts` | 39 tests passed in 4 files | Existing pure/mocked checks pass despite the financial gaps below. |
| `node node_modules/eslint/bin/eslint.js scripts/run-premortem.mjs scripts/premortem-monetary.ts` | Passed | Targeted lint of the added scripts only. |

Raw local artifacts: `.agoragentic/premortem-ePvI1M/report/`, including
`audit-guide.html`, `premortem.md`, `golden-loop.md`, and `passport-run.json`.
The wrapper audits committed HEAD; new scripts/report were checked separately.
An initial in-memory archive attempt exceeded its buffer; the wrapper was fixed
to archive to disk, and the subsequent complete run above succeeded in executing
the audit. An `npx --no-install eslint` attempt timed out; direct local ESLint
execution completed successfully.

Not run: full test suite, production smoke tests, payout requests, DB migrations,
database race reproductions, bank reconciliation, physical assay or legal review.
No application monetary behavior was changed, committed, pushed or deployed.

## Tool Finding Triage

The scanner reported 25 secret-pattern locations and stopped at its 25-finding
cap. Of those locations, one needs immediate credential review:
`audit/playwright-audit.js:14` contains a nonempty hardcoded password fallback
used for a deployed-site login at line 143. Its validity was not tested and its
value is intentionally omitted. Treat it as potentially exposed: the credential
owner should revoke/rotate it if ever valid, remove the fallback, review access
logs, and assess Git-history exposure. Deleting the current literal alone would
not revoke a credential. These remediation actions have **not** been performed.

The other 24 reported locations are runtime expressions or test fixtures on
inspection, not evidence of 24 additional leaked credentials. Examples include
environment reads in `mcp/src/server.ts:228`, an options assignment in
`sdk/src/client.ts:273`, and synthetic test inputs in
`sdk/src/__tests__/client.test.ts:24`. Use a dedicated, uncapped secret scan and
human triage before claiming a clean tree/history; do not globally suppress the
rule to get a green score. Local `.env` files were excluded and not inspected.

The root package is private (`package.json:4`), so an OSS-license finding is not
automatically a private-service launch blocker. However, the SDK is configured
for public distribution and declares MIT metadata (`sdk/package.json:4,9,65-67`)
without a standalone license file found in the root or SDK. The rights holder
must establish intended licensing and distribution text. No license was chosen
or added on the owner's behalf.

## Failure Frame

It is September 2027. Users relied on signed backing and payout claims, but the
ledger could not reconcile deposits, outstanding claims or completed withdrawals.
A disputed physical lot then revealed that a valid signature proved only who
reported the lot, not ownership, inventory existence or redemption availability.
Trust and liquidity failed before multi-commodity optimization mattered.

This is a scenario, not a forecast. Priority below reflects observable exposure
and impact, not invented numerical geopolitical probabilities.

## Critical Findings

### P0-1: Monetary Units And Prices Disagree

Evidence: checkout uses `$5/ANGEL` in
`src/app/api/v1/angelcoin/buy/route.ts:60,91-115`; the older rate and redeem routes
use `$0.01/ANGL` in `src/app/api/v1/angelcoin/rate/route.ts:15-20` and
`src/app/api/v1/angelcoin/redeem/route.ts:9-11`. The Stripe webhook records
`creditAmount * 100_000` as USD micros (`src/lib/stripe.ts:286-296`), while
`src/app/api/v1/rate/route.ts:41` divides those micros by 1,000,000. A five-coin,
$25 checkout therefore contributes $0.50 to that reported reserve proxy. This is
source-level arithmetic, not a claim that a real customer made this purchase.

Prevent: define one versioned denomination contract, distinguishing utility
credits, currency amounts and any new asset claims. Use integer minor units or
exact decimals, record verified paid amounts/currency, and reconcile refunds and
chargebacks. Existing persisted balances require a reviewed migration decision;
do not silently reinterpret them or guess which rate is authoritative.

Detect/stop: block a real-value release if checkout, webhook, ledger, rate, SDK
and redemption round-trip tests disagree by any amount beyond explicitly defined
rounding. Owner: monetary/product lead plus accounting reviewer, before issuance.

### P0-2: Reserve Claims Are Not Reserve Measurements

Evidence: `src/app/api/v1/rate/route.ts:36-46,95-99` sums historical top-ups,
hard-codes the launch rate, and advertises 100% backing. It does not subtract
reserve outflows or query a bank/custodian. `buy-on-behalf/route.ts:123-155` under
the same AngelCoin API credits a wallet and records a counted ledger entry
without checking prefunding in that transaction. Signing a report authenticates
its bytes, not the underlying balance. `src/lib/angelcoin/monetary.ts:162-168`
also returns an empty signature when its signing key is absent.

Prevent: distinguish `unverified`, `reported`, `independently_attested`, `stale`
and `quarantined` reserves; do not describe a proxy as audited backing. Reconcile
all liabilities and settled net assets at the same cut-off. Exclude unfunded
grants, encumbered inventory and stale valuations. Require signature/key-version
validation and fail closed for any endpoint claiming a signed attestation.

Detect/stop: any reconciliation difference, missing evidence or stale attestation
blocks new asset issuance. Owner: finance/custody lead and backend lead. Contain
damage by disabling new issuance rather than asserting that signatures or bonds
automatically reimburse losses.

### P0-3: The Pricing Floor Is Not A Solvency Guard

Executed evidence from `src/lib/angelcoin/monetary.ts:127-156`:

| Synthetic reserve | Supply | Returned redemption rate | Aggregate quoted value | Shortfall |
|---|---|---|---|---|
| $10,000 | 2,000 | $4.50 | $9,000 | $0 |
| $1,000 | 100,000 | $4.50 | $450,000 | $449,000 |
| $0 | 2,000 | $4.50 | $9,000 | $9,000 |

The existing test at `src/lib/angelcoin/__tests__/monetary.test.ts:123-132`
accepts the high price in the undercollateralized case. The function is not wired
as a live revaluation job in the reviewed rate route. These outputs demonstrate
a design gap, not actual insolvency or completed payouts.

Prevent: separate display price from enforceable redemption obligations. Specify
coverage and liquidity constraints before implementing mint authorization; do
not simply haircut existing customer claims in software. Add conservation,
zero-reserve, reserve-loss, stale-price, numeric-boundary and concurrent issuance
tests. Owner: monetary lead and independent reviewer. Stop new asset issuance
whenever eligible reserves fail the approved liability-coverage rule.

### P0-4: Redemption Reports An Unperformed Payout

Evidence: `src/app/api/v1/angelcoin/redeem/route.ts:85-155` checks wallet funds
before a transaction, computes but does not enforce a treasury check, and then
unconditionally decrements the wallet. Lines 157-168 claim a Stripe payout and
ETA without calling a payout provider. Concurrent requests can pass the same
precheck; this race was identified statically, not reproduced against a DB.

Prevent: until a real payout workflow exists, refuse unsupported redemption
without debiting, or offer an explicitly approved request-only workflow. Implement
idempotent requests, atomic available-funds reservation, a durable payout/outbox
state machine, provider reconciliation and compensation for confirmed failures.
Never label an internal hash as proof of completed external payment.

Detect/stop: pending payouts beyond the agreed SLA, duplicate provider operations
or negative available balances trigger an incident. Test retry-after-timeout,
duplicate webhook, provider failure and competing withdrawals against an isolated
DB/provider sandbox before real funds. Owner: payments lead. Do not run these
tests against the production database.

### P0-5: Cryptographic Proof Is Mistaken For Physical Proof

Evidence: current Prisma accounting models have journal entries and optional
backing metadata (`prisma/schema.prisma:278-310`), not the proposed physical lot,
assayer and custody model. The economic design itself lists a reserve module as
work to create (`docs/angelcoin-economic-design.md:333-343`). No implemented
physical reserve API or evidence of verified pilot inventory was found.

Prevent: first build a read-only gold-lot evidence register with custody/title
references, independent assay and acceptance attestations, unit/precision rules,
unique lot identity, append-only lifecycle events and quarantine. Redact physical
locations, personal data and sensitive documents from public proofs. Bind a
versioned Merkle root to the asset set, liabilities, valuation cut-off and signer
identities. Inclusion proves membership in a declared set, not completeness,
physical existence, unencumbered title or redeemability.

Detect/stop: duplicate lots, conflicting assays, stale feeds, lost custody or
maintenance gaps quarantine affected assets and block their use for new issuance.
Tests must cover replay, forged/revoked signer, duplicate serial, out-of-order
events, unit mismatch, quarantine exclusion and independent proof verification.
Owner: custody/assay lead and security lead. Physical verification is a human and
institutional dependency, not something to simulate as passed in code.

## Operational Risks

| Risk | Prevention | Tripwire and containment | Proposed accountable role |
|---|---|---|---|
| No lawful ownership, offering or redemption authority | Obtain jurisdiction-specific legal review, custody agreements, responsible-sourcing checks and applicable sanctions screening before real-value use | Missing approval or refused counterparty clearance: no launch; suspend affected activity for review, not a sanctions-bypass route | Legal/compliance lead |
| Asset-rich but cash-poor redemption run | Measure executable liquidation bids, settlement delays, costs, encumbrances and cash buffers; test a small licensed cash-out path before retail adoption | Liquidity below approved payout needs: halt new exposure and execute the documented customer-protection plan | Treasury lead |
| Insider fraud or compromised assay hardware | Separate custody, assay, approval and key roles; independent inspection, calibration and key revocation; preserve human review | Conflicting attestations or missing custody evidence: quarantine and investigate, no automatic punitive slashing | Custody/security leads |
| Ghost-state outage becomes indefinite lockup | Defer autonomous trading/freezes; document narrow pause powers, customer treatment, restart criteria and escalation | Missed recovery SLA: page a named alternate and exercise a reviewed recovery procedure; no unverified auto-unfreeze | Operations lead |
| Single-host loss or key compromise | Isolated restore drills, tested encrypted backups, key rotation and incident runbooks | Failed restore or missing independent backup: no production readiness claim | Operations/security leads |
| Unsubstantiated social/environmental claims | Local consultation, transparent fees, independent monitoring and a usable complaints process | Missing consent or harmful pilot outcomes: stop expansion and remediate | Pilot/community lead |

Role names are proposals, not assignments. The project owner must name an actual
person and review date for every gate before treating it as owned.

## Corrections To The Earlier Draft

- A multi-sensor assay is not unspoofable. Hardware needs validation, maintenance,
  independent custody checks and an error/dispute process.
- A bond is finite and may be correlated with the failing asset. Slashing does
  not guarantee restitution or replace due process.
- B2B settlement, barter or a different transport rail does not automatically
  remove regulatory obligations or make prohibited transactions lawful.
- With six-second blocks, 144 blocks is 14.4 minutes, not approximately 14 hours.
  Neither interval proves safe autonomous recovery.
- No hazardous anti-personnel vault defenses, automatic destruction of access,
  or unilateral revocation of lawful oversight belong in this implementation.
- Gold backing alone cannot guarantee a nonzero token price or accessible
  redemption. Legal title, liquidity, custody and operational access still matter.

## Next Gates

1. **Contain existing risks:** credential owner reviews the exposed fallback;
   payments owner resolves unsupported payout claims and backing representations.
   Do not presume remediation has occurred merely because this report exists.
2. **Fix accounting first:** agree denomination/redemption semantics and migration
   treatment, reconcile liabilities and settled assets, then add failing-first
   integration tests for the critical cases above.
3. **Implement the narrow prototype:** local/read-only, gold only, no live minting,
   no implied sovereign sponsorship, no seeded inventory represented as real.
4. **Require external evidence:** signed custody/title documents, independent
   assay, applicable legal approvals, liquidation/cash-out evidence and tested
   recovery. Store references securely; public proofs disclose only what is needed.
5. **Authorize a capped pilot separately:** assign people, exposure limits,
   operational SLAs, incident procedures and explicit approval after independent
   review. Passing a keyword audit cannot satisfy this gate.

Reverse premortem: waiting for the entire geopolitical architecture could prevent
useful learning. The proportionate alternative is to repair accounting and test a
read-only evidence register now, not to launch an unverified asset-backed currency.
