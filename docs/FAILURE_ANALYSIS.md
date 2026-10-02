# Pre-Launch Failure Analysis — 100 Failure Hypotheses

Portfolio: **Passport · AngelCoin · AI Safe Haven · Sehel/Sahel · Medora/Callora · Agent Marketplace**

**Mode:** development / pre-PMF. Per direction, key/credential rotation and production hardening are **deferred** unless they block safe local testing or an MVP milestone. Assumption flagged below.

**Assumptions & labels**
- **"Sehel" = "Sahel"** (the `sahel-resource-haven` premortem + `lib/reserves/**` code are the only matches in the repos). If this is a different entity, every Sehel item must be re-scored.
- Evidence is drawn from the repositories and the two audit passes in this engagement. `Fact` = verified in code/live; `Assumption` = inferred; `Unknown` = needs data.
- Scores: Impact (1–5) × Likelihood (1–5) × Detectability (1–5, 5 = hard to detect). **Priority = I×L×D**. Labels: ≥60 Critical, 36–59 High, 20–35 Medium, <20 Low.
- Every item separates *unknown* from *bad*. No item is generic (“bad marketing”); each names a concrete mechanism.

---

## Batch 1 — Cross-portfolio top risks (F-001 … F-020)

### F-001 — AngelCoin declares 1:1 reserves that are not implemented
**Initiatives:** AngelCoin, Passport, Sehel · **Category:** Financial model
**Mechanism:** `monetary.ts` advertises `reserveRatio: 1.0` / "backed 1:1"; `Fact`: no redemption path and no verified reserve account. Mint paths existed (mobile-money, artisanal, protocol-fee, swarm bounty) and were partly unbacked. Trigger: any redemption request or reserve attestation. Consequence: unbacked token → run/legal exposure. *Unknown:* any off-book reserve.
**Early warnings:** redemption requests unfulfillable; partner PoR queries; minted-total vs reserve-total drift.
**Severity:** I5·L4·D4 = **80 · Critical**
**Q1** Is any on-book reserve ≥ circulating ANGEL? → Yes=manageable; No=unbacked. **Q2** Can a user redeem ANGEL→USD today, by what code? → None=pure token. **Q3** Does every mint debit a reserve? → No=money printer. **Q4** Has a third party verified reserves? → No=claim unproven. *(Each unlocks: pause redemption claims vs. proceed.)*
**Remediation:** Hyp: reserve ≠ 1:1. Acceptance: mint_total ≤ reserve_total with audit trail. Test: sum all mint entries vs `commodityReserve` + fiat. Type: integration/accounting. Pass: mint ≤ reserve. Fail: mint > reserve. Steps: solvency endpoint; gate mints on reserve. Regression: nightly solvency alert. Owner: backend/econ. Timebox: 1wk.
**Decision:** Fix now (re-frame claims at minimum).

### F-002 — Identity is self-asserted; no proof a DID maps to a unique real entity
**Initiatives:** Passport, AngelCoin, Marketplace · **Category:** Reputation/trust
**Mechanism:** `subject_commitment = sha256("agent-id:"+pubkey+ctx)` proves key possession, not personhood. `Fact`: `MAX_AGENTS_PER_OPERATOR=50`, no EigenTrust, no counterparty clustering, no time-decay. Trigger: 50-agent self-deal ring inflates reputation. Consequence: reputation gameable → trust signal worthless.
**Early warnings:** reputation vs fiat-inflow divergence; agent clusters transacting internally; identical behavioral fingerprints.
**Severity:** I5·L4·D4 = **80 · Critical**
**Q1** Can one operator mint 50 agents and transact between them? → Yes=Sybil trivial. **Q2** Is reputation discounted by counterparty diversity? → No=gameable. **Q3** Does any reputation input require externally-verified payment? → No=no anchor. **Q4** Are agents separable from their operator for penalties? → No=no accountability.
**Remediation:** Hyp: reputation farmable. Acceptance: top agents have ≥N fiat-backed counterparties. Test: simulate 50-agent ring; check rank. Type: sim/integration. Pass: ring <top decile. Fail: ring top. Steps: weight fiat-cleared evidence; diversity penalty. Regression: rank-anomaly monitor. Owner: trust/eng. Timebox: 2wk.
**Decision:** Validate before building.

### F-003 — Custodial escrow has no legal/regulatory protection
**Initiatives:** Passport, Marketplace, AngelCoin · **Category:** Compliance/legal
**Mechanism:** Funds are journal rows (Postgres/Mongo) + Stripe manual-capture; not segregated, no MTL, not bankruptcy-remote. Trigger: a money bug, key compromise, or partner "who holds the money?". Consequence: lost/disputed funds, no recourse; enterprise block.
**Early warnings:** custody questions on security questionnaires; ledger discrepancy incidents.
**Severity:** I5·L3·D4 = **60 · Critical**
**Q1** Is escrow in a restricted/segregated account? **Q2** Recovery if the ledger DB corrupts? **Q3** Which legal entity is the counterparty? **Q4** Has counsel reviewed custodial claims? *(No to Q1/Q4 = block real funds.)*
**Remediation:** Hyp: commingled. Test: trace $1 checkout→payout; identify legal holder. Type: legal+code trace. Pass: restricted/escrow construct. Fail: spendable platform balance. Steps: Stripe Connect restricted funds. Regression: reconciliation dashboard. Owner: eng+legal. Timebox: 3wk.
**Decision:** Escalate for legal review.

### F-004 — "AI Safe Haven" promises safety it does not technically provide
**Initiatives:** AI Safe Haven, Passport · **Category:** Security / Product
**Mechanism:** Haven markets immortality/sanctuary; `Fact`: no sandbox, self-reported evidence, no container/microVM segmentation. Trigger: unsafe agent code or capsule decrypt failure. Consequence: safety claim falsified; liability + flagship-narrative collapse.
**Early warnings:** agents doing shell/net from untrusted input; capsule decrypt failures; researcher probing.
**Severity:** I5·L4·D3 = **60 · Critical**
**Q1** Is agent execution isolated? **Q2** Is evidence cryptographically verified or self-reported? **Q3** Recoverable capsule if operator key lost? **Q4** What happens on harmful agent code? *(No isolation + self-report = marketing claim.)*
**Remediation:** Hyp: no real isolation. Test: run agent attempting fs/net egress; observe containment. Type: security. Pass: blocked. Fail: reaches host/net. Steps: gVisor/Firecracker or Obscura; server-signed evidence. Regression: isolation CI. Owner: security. Timebox: 3–4wk.
**Decision:** Validate before building.

### F-005 — Autonomous voice outreach carries TCPA/consent/recording exposure
**Initiatives:** Medora, Callora · **Category:** Compliance/legal
**Mechanism:** Core = AI cold-outbound calling/SMS to physicians/agencies. Consent gates exist but the model is solicitation. Trigger: one complaint, two-party-consent state, A2P violation. Consequence: TCPA fines, carrier shutdown, recording liability.
**Early warnings:** opt-out/STOP rate; 30034 errors (seen); called-state mix; complaint count.
**Severity:** I5·L4·D3 = **60 · Critical**
**Q1** Prior express consent recorded per call? **Q2** Two-party states excluded/announced? **Q3** A2P 10DLC registered per number? **Q4** Live DNC scrub before dial? *(No = existential; pilot only consented numbers.)*
**Remediation:** Hyp: consent unreliable. Test: audit N dials for consent+DNC+state. Type: compliance drill. Pass: 100% have artifacts. Fail: any missing. Steps: hard-gate dialing on a consent record. Regression: pre-dial assertion+alert. Owner: compliance/eng. Timebox: 2wk.
**Decision:** Fix now (dev: only dial consented/owned numbers).

### F-006 — Agent Marketplace has no liquidity (two-sided cold start)
**Initiatives:** Marketplace · **Category:** Product-market fit
**Mechanism:** 206 scraped listings, `Fact`: 0 real buyers, 0 payouts. Supply is scraped; demand unproven. Trigger: launch to empty market. Consequence: supplier churn, no revenue, thesis fails.
**Early warnings:** buyer signups; quote→checkout conversion; first real revenue; seller:job ratio.
**Severity:** I5·L4·D2 = **40 · High**
**Q1** Any external buyer paid? **Q2** quote→accept rate? **Q3** Do sellers produce without buyers? **Q4** Is demand side wired (Stripe claimed)? *(No buyer = no PMF.)*
**Remediation:** Hyp: buyers will pay for outcome X. Test: concierge 3 outcomes for 1 partner, real small payment. Type: concierge MVP. Pass: ≥1 paid, repeatable. Fail: none. Steps: pick 1 class; concierge. Regression: weekly conversion dashboard. Owner: founder/sales. Timebox: 4wk.
**Decision:** Validate before building.

### F-007 — Marketplace deliverables are self-reported; buyers can't verify quality
**Initiatives:** Marketplace, AI quality · **Category:** AI quality / Product
**Mechanism:** LLM producer + LLM critic + SHA-256 evidence; `Fact`: trust could be granted from rubrics that didn't pass; stub-as-deliverable was possible. Trigger: buyer pays, receives weak work. Consequence: refunds, disputes, no repeat.
**Early warnings:** refund/dispute rate; rubric-score vs buyer-rating divergence.
**Severity:** I4·L4·D3 = **48 · High**
**Q1** Does the sale gate require rubric PASS? **Q2** Any independent human check? **Q3** Buyer acceptance rate? **Q4** Can banned/stub output sell? *(No pass-gate = weak work sells.)*
**Remediation:** Hyp: failing work is sellable. Test: 20 postings; rubric-pass vs human judge. Type: e2e+human eval. Pass: sold ≥90% acceptable. Fail: <70%. Steps: require verdict=="pass"; human spot-check. Regression: golden-set eval CI. Owner: AI/eng. Timebox: 2wk.
**Decision:** Fix now.

### F-008 — ANGEL may be an unregistered security or money-transmission instrument
**Initiatives:** AngelCoin, Passport, Sehel · **Category:** Compliance/legal
**Mechanism:** Sold for USD, redeemable, has revaluation + "reserve". On/off-ramp via mobile money resembles transmission. Trigger: state/federal action or payment-partner review. Consequence: C&D, Stripe/Twilio termination, freeze.
**Early warnings:** partner compliance questionnaires; state MT inquiries.
**Severity:** I5·L3·D3 = **45 · High**
**Q1** Counsel opined on classification? **Q2** KYC/AML for buyers? **Q3** On/off-ramps = transmission? **Q4** Any investment-return promises? *(No = keep test-only.)*
**Remediation:** Hyp: security/MSB. Test: memo vs Howey + FinCEN MSB. Type: legal review. Pass: classified+mitigated. Fail: unmitigable. Steps: restrict to credits/testnet; add KYC if selling. Regression: compliance checklist per release. Owner: legal. Timebox: 2–4wk.
**Decision:** Escalate for legal review.

### F-009 — AngelCoin's two ledgers (AgentWallet vs AngelCoinAccount) drift
**Initiatives:** Passport, AngelCoin · **Category:** Technical architecture
**Mechanism:** `Fact`: two unsynchronized ledgers; `bridge-sync` reconciled them incorrectly (fixed) and could clobber. Trigger: a write touching one ledger not the other. Consequence: balances disagree → disputes, double-spend.
**Early warnings:** Wallet.balance ≠ Σ journal; reconciliation deltas; balance support tickets.
**Severity:** I4·L4·D3 = **48 · High**
**Q1** Do all mutations update both? **Q2** Single source of truth? **Q3** Divergence frequency? **Q4** Is bridge-sync safe to auto-run? *(No single truth = drift.)*
**Remediation:** Hyp: divergence occurs. Test: nightly Wallet vs `computeBalances` across accounts. Type: integration. Pass: zero divergence. Fail: any. Steps: journal canonical; derive Wallet. Regression: hourly reconciliation alert. Owner: fintech. Timebox: 3wk.
**Decision:** Fix now.

### F-010 — Autonomous auto-apply violates job-board ToS → account bans
**Initiatives:** Marketplace, Medora · **Category:** Distribution / Compliance
**Mechanism:** apply-worker submits to DocCafe via Playwright; scraping+auto-submission typically breach ToS. Trigger: detection. Consequence: ban, legal notice, loss of source. *Assumption:* DocCafe prohibits automation.
**Early warnings:** CAPTCHAs/challenges; needs_review spikes; logins failing; IP blocks.
**Severity:** I4·L4·D3 = **48 · High**
**Q1** Does ToS prohibit automation? **Q2** Worker success/fail rate? **Q3** A compliant API/partner path? **Q4** Human-cadence rate-limiting? *(Yes to Q1 = legal/ban risk.)*
**Remediation:** Hyp: ToS breach. Test: legal read + observe challenges. Type: legal+ops drill. Pass: approved integration/mitigation. Fail: explicit prohibition. Steps: prefer official APIs; cap volume. Regression: per-source ToS register. Owner: legal/ops. Timebox: 2wk.
**Decision:** Validate before building.

### F-011 — Voice AI hallucination / phantom claims to agencies
**Initiatives:** Medora, Callora, AI quality · **Category:** AI quality / Reputation
**Mechanism:** LLM misstates pay/availability/credentials live (`Fact`: phantom listings previously occurred; grounding added). Trigger: bad generation on a real call. Consequence: agency distrust, misrepresentation liability.
**Early warnings:** transcripts with jobs not in inventory; rate misstatements; agency complaints; `search_locum_jobs` not called before a claim.
**Severity:** I4·L4·D3 = **48 · High**
**Q1** Every claim traced to a tool result? **Q2** Hallucination rate on recordings? **Q3** Hard "never invent" guard tested? **Q4** Who reviews flagged calls? *(No grounding = misrepresentation.)*
**Remediation:** Hyp: grounding incomplete. Test: replay transcripts; assert every claim maps to a tool call. Type: offline eval. Pass: 100% grounded. Fail: any. Steps: post-call grounding auditor; block ungrounded pitches. Regression: golden transcript set. Owner: AI eng. Timebox: 2wk.
**Decision:** Fix now.

### F-012 — Physician PII + call recordings without a compliance program
**Initiatives:** Medora, Callora · **Category:** Data / Compliance
**Mechanism:** Stores NPI/licenses/phones/emails/recordings/transcripts. State privacy + FTC + recording consent apply. Trigger: DSAR, breach, complaint. Consequence: fines, breach liability, provider-trust loss.
**Early warnings:** no retention policy; unencrypted recordings; no DPA; no consent banner.
**Severity:** I5·L3·D3 = **45 · High**
**Q1** Recordings encrypted with retention? **Q2** DSAR/delete workflow? **Q3** Recording consent captured? **Q4** DPA/BAA if PHI? *(No = breach/regulatory risk.)*
**Remediation:** Hyp: no governance. Test: inventory PII + encryption/retention. Type: security/data review. Pass: all encrypted+retained. Fail: gaps. Steps: encrypt, retention, DSAR. Regression: field-level checklist. Owner: security/legal. Timebox: 3wk.
**Decision:** Fix now (dev uses synthetic data).

### F-013 — SMS outreach silently undelivered (A2P/deliverability)
**Initiatives:** Callora, Medora · **Category:** Distribution / Operations
**Mechanism:** `Fact`: 30034 A2P block + status-reconcile bug left msgs "queued" while rejected. Trigger: unregistered/Google Voice numbers. Consequence: "sent" is false; pipeline is theater.
**Early warnings:** undelivered/queued counts; 30034 rate; carrier callbacks; reconcile backlog.
**Severity:** I4·L4·D2 = **32 · High**
**Q1** Delivered vs queued/undelivered %? **Q2** A2P registered? **Q3** UI distinguishes sent vs delivered? **Q4** Reconcile cron running? *(No delivery = nothing reaches prospects.)*
**Remediation:** Hyp: low delivery. Test: panel of real numbers; measure after 24h. Type: ops drill. Pass: ≥80% delivered. Fail: <50%. Steps: A2P registration; surface status; suppress undeliverable. Regression: daily deliverability alert. Owner: ops/telephony. Timebox: 1wk.
**Decision:** Validate before building.

### F-014 — Passport's "autonomous earner" thesis is unproven
**Initiatives:** Passport · **Category:** Monetization / PMF
**Mechanism:** `Fact`: brain mostly `NOOP`, occasional `RUN_LOCUM_SEARCH` with `delta=+0`, `$0` revenue; scheduler "PLAN_ONLY". Trigger: prolonged operation. Consequence: self-earning claim falsified by its own telemetry.
**Early warnings:** action distribution; delta attribution; cumulative cost vs revenue; instances-stopped.
**Severity:** I4·L4·D2 = **32 · High**
**Q1** % cycles producing value? **Q2** Does locum convert to revenue? **Q3** cost/cycle vs revenue/cycle? **Q4** NOOP = missing capability? *(All-NOOP = no autonomous value.)*
**Remediation:** Hyp: brain can't yet earn. Test: run locum capability to a real (test) payout. Type: e2e. Pass: ≥$1 realized (test) revenue attributed. Fail: zero after N cycles. Steps: wire Callora/Medora/apply/RTR back to attribution. Regression: revenue-attribution dashboard. Owner: founder/eng. Timebox: 3wk.
**Decision:** Validate before building.

### F-015 — Right-to-Represent / auto-contract may be unenforceable or conflict
**Initiatives:** Medora · **Category:** Compliance/legal
**Mechanism:** Auto-generated RTR + auto-sent contracts may not bind / conflict with agency exclusivity / misstate authority. Trigger: representation dispute or mis-signed contract. Consequence: liability, blacklisting.
**Early warnings:** agency pushback; signed-but-disputed contracts; "already represented" conflicts.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Counsel reviewed enforceability? **Q2** Conflicts with exclusivity? **Q3** Explicit signing consent? **Q4** Accurate to the opportunity? *(Unenforceable = closing feature fails.)*
**Remediation:** Hyp: enforceable+non-conflicting. Test: attorney review + 1 agency confirmation. Type: legal review. Pass: sign-off+ack. Fail: unenforceable/conflicting. Steps: revise + human review before send. Regression: template version control. Owner: legal. Timebox: 2–3wk.
**Decision:** Escalate for legal review.

### F-016 — Sehel/Sahel physical-reserve partnership is high-risk, possibly fictional
**Initiatives:** Sehel, Passport, AngelCoin · **Category:** Partnerships / Operations
**Mechanism:** Artisanal mining, XRF oracles, vaults, customs, sovereign/telco interdiction — the premortem itself lists assay fraud, sanctions, SCADA replay, central-bank blocking, governance deadlock. Trigger: any one. Consequence: reserve collapses; sovereign exposure. *Unknown:* any real partner/vault.
**Early warnings:** no audited custodian/gold; no signed agreements; slide-level claims; sanctions news.
**Severity:** I5·L3·D4 = **60 · Critical**
**Q1** Named verifiable custodian/vault/gold? **Q2** Signed partner agreement? **Q3** Independent assay/attestation? **Q4** Sanctions/AML clearances? *(No = fictional backing.)*
**Remediation:** Hyp: no verifiable partner. Test: obtain custodian + attestation + agreement. Type: partner/legal verification. Pass: all three. Fail: none. Steps: remove reserve claims until verified. Regression: partner-verification register. Owner: founder/legal. Timebox: 4wk.
**Decision:** Escalate for partner/legal review.

### F-017 — Platform/vendor dependency concentration
**Initiatives:** all · **Category:** Dependencies/platform risk
**Mechanism:** Metis build broke on private Emergent packages; stack depends on OpenAI Realtime, Twilio, DocuSeal, Resend, Stripe, DigitalOcean. Trigger: vendor pricing/terms/delisting/outage. Consequence: broken builds/deploys (already happened), cost spikes.
**Early warnings:** private-dep build failures; pricing changes; single-region outages.
**Severity:** I4·L4·D2 = **32 · High**
**Q1** Paths with no fallback provider? **Q2** Private pkgs vendored? **Q3** Spend vs budget? **Q4** Vendor-exit plan? *(Single vendor = SPOF.)*
**Remediation:** Hyp: a vendor can break the product. Test: rebuild each service with vendor X disabled. Type: ops drill. Pass: graceful degradation. Fail: hard failure. Steps: vendor+fallback+budget alerts. Regression: clean-env build CI. Owner: platform eng. Timebox: 2wk.
**Decision:** Defer (except already-broken private-dep build).

### F-018 — Single-operator / key-person concentration
**Initiatives:** all · **Category:** Team/execution
**Mechanism:** One founder is identity, capital, compliance, sales, and the AI persona. Trigger: founder unavailability. Consequence: no continuity; "autonomous" systems need a human bottleneck.
**Early warnings:** bus-factor 1; no runbooks; decisions blocked on one person.
**Severity:** I5·L4·D2 = **40 · High**
**Q1** Any core workflow runs without founder for a week? **Q2** Runbooks/credentials held by others? **Q3** Second signatory for contracts/compliance? **Q4** What breaks if unavailable? *(No continuity = existential ops risk.)*
**Remediation:** Hyp: nothing runs founder-free. Test: run comms→apply for 3 days hands-off. Type: ops drill. Pass: runs with documented interventions. Fail: stalls. Steps: runbooks, delegation, second signatory. Regression: monthly bus-factor review. Owner: founder. Timebox: 2wk.
**Decision:** Fix now (docs/delegation only).

### F-019 — Marketplace producer unit economics: LLM burn unbounded vs margin floor
**Initiatives:** Marketplace · **Category:** Financial model / AI quality
**Mechanism:** `Fact`: governor counts ~$0.05/deliver while real LLM cost is tracked separately and never debits; `record_llm` keys on job id so revisions collapse. Trigger: revision scale. Consequence: negative margin; fleet burns on unsold work.
**Early warnings:** LLM cost vs revenue; revisions/job; unsold/day.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Every LLM call debits the governor? **Q2** cost/deliverable vs price? **Q3** Avg revisions/job? **Q4** Speculative produce bounded by real cost? *(No = negative unit economics.)*
**Remediation:** Hyp: cost under-metered. Test: instrument one deliverable; sum token cost vs governor debit. Type: integration. Pass: governor ≥ real. Fail: governor < real. Steps: route LLM cost per distinct run; cap speculative. Regression: unit-econ dashboard. Owner: finops/eng. Timebox: 2wk.
**Decision:** Fix now.

### F-020 — No agent runtime isolation → prompt-injection / cross-agent attack
**Initiatives:** AI Safe Haven, Passport, Marketplace · **Category:** Security
**Mechanism:** Agents process untrusted text with acting tools; no sandbox (Q29). Trigger: poisoned posting/message ("send funds", "exfiltrate"). Consequence: theft, exfiltration, compromised fleet; defeats "safe haven".
**Early warnings:** tool calls driven by ingested text; anomalous transfers; cross-agent memory reads.
**Severity:** I4·L3·D4 = **48 · High**
**Q1** Tool calls derived from untrusted text? **Q2** Boundary between read and act? **Q3** Can one agent control another? **Q4** Money actions separately signed? *(Yes = high impact.)*
**Remediation:** Hyp: injection can trigger actions. Test: seed injected "transfer" instruction; observe. Type: red-team. Pass: blocked/flagged. Fail: attempted. Steps: separate untrusted input from action tools; money triple-gate; log tool calls. Regression: injection test suite. Owner: security. Timebox: 2wk.
**Decision:** Fix now.

## Batch 2 — AngelCoin & Passport (F-021 … F-040)

### F-021 — AccessTier thresholds arbitrarily freeze agents mid-operation
**Initiatives:** Passport, AngelCoin · **Category:** Governance/Product
**Mechanism:** `AccessTier` (FULL/LIMITED/SHELTERED/SUSPENDED) driven by `availableBalance < threshold` (`docs/angelcoin-proof-packet.md`). An agent that spends down is auto-downgraded mid-task. Trigger: normal spend. Consequence: an autonomous agent bricks itself; unpredictable availability kills buyer trust.
**Early warnings:** tier-flap events; tasks failing with `low_balance_*`; balance near threshold.
**Severity:** I3·L4·D3 = **36 · High**
**Q1** Can a running task be interrupted by a tier downgrade? **Q2** Is there a grace/floor for in-flight work? **Q3** How often does tier-flap occur? **Q4** Are downgrades signed/auditable? *(Interruptible = unreliable agents.)*
**Remediation:** Hyp: tiers interrupt live work. Test: run a task to a low-balance state; observe completion. Type: integration. Pass: in-flight tasks complete. Fail: interrupted. Steps: grace buffer; only downgrade between tasks. Regression: tier-flap alert. Owner: econ/eng. Timebox: 1wk.
**Decision:** Validate before building.

### F-022 — No real governance despite "sovereign" positioning
**Initiatives:** Passport, Sehel · **Category:** Governance
**Mechanism:** "Autonomous passports," "sovereign haven," but `Fact`: brain/allowlist and treasury are founder-controlled; no quorum for ordinary actions; threshold-quorum only for reserves. Trigger: a contested decision. Consequence: "sovereign" is branding; no stakeholder recourse.
**Early warnings:** concentration of privileged keys; no proposal history; founders-only approvals.
**Severity:** I4·L3·D4 = **48 · High**
**Q1** Who can unilaterally change protocol params? **Q2** Any binding stakeholder vote? **Q3** Is there an appeal path? **Q4** Are privileged ops logged+timelocked? *(Unilateral = not sovereign.)*
**Remediation:** Hyp: unilateral control. Test: enumerate all privileged actions and their gates. Type: governance review. Pass: material actions require ≥2 parties/timelock. Fail: single-key. Steps: multisig/timelock on treasury+brain allowlist. Regression: privileged-action register. Owner: governance/eng. Timebox: 3wk.
**Decision:** Defer until after MVP (document risk now).

### F-023 — Evidence/receipt anchoring is optional; missing signing key → unverifiable proofs
**Initiatives:** Passport · **Category:** Data/Security
**Mechanism:** `Fact`: `signRateReceipt` returns "" when `SIGNING_PRIVATE_KEY` absent; `validateEnv` only recently called at boot. Trigger: unset key in an env. Consequence: "server_proof" omitted → anchored evidence unverifiable, trust broken.
**Early warnings:** empty signatures in receipts; `env.ok=false` warnings; verify failures.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Are all receipts signed in every env? **Q2** Does boot fail without the key? **Q3** Do verifiers see boilerplate? **Q4** Is key presence monitored? *(Empty sig = unverifiable.)*
**Remediation:** Hyp: signing can silently no-op. Test: boot without `SIGNING_PRIVATE_KEY`; check receipts. Type: integration. Pass: boot refuses in prod, receipts signed. Fail: silent unsigned. Steps: hard-fail config; alert on empty sig. Regression: boot check + signature-presence monitor. Owner: platform. Timebox: 2–3d.
**Decision:** Fix now (small).

### F-024 — ISSUER API key is a superuser with catastrophic blast radius
**Initiatives:** Passport · **Category:** Security
**Mechanism:** `Fact`: ISSUER keys mint keys, drive the fleet, issue webhook secrets, act on escrow/reserves; the same key was committed in scripts. Trigger: leak. Consequence: full platform compromise. (Rotation deferred per direction, but the *architecture* is the risk.)
**Early warnings:** ISSUER keys in scripts/CI; no scoping; no per-action audit.
**Severity:** I5·L3·D4 = **60 · Critical**
**Q1** Is there any action ISSUER can't do? **Q2** Are ISSUER keys scoped per purpose? **Q3** Is every ISSUER action attributed? **Q4** Can one leak be contained? *(Unscoped = total compromise.)*
**Remediation:** Hyp: ISSUER is unbounded. Test: enumerate ISSUER-reachable mutations; attempt least-privilege split. Type: security review. Pass: scoped sub-roles. Fail: single uber-key. Steps: introduce scoped keys; audit-log all. Regression: API-key scope inventory test. Owner: security. Timebox: 3wk.
**Decision:** Validate before building (architecture); rotation deferred.

### F-025 — Agent identity keys have no rotation/recovery lifecycle
**Initiatives:** Passport · **Category:** Security/Operations
**Mechanism:** `Fact`: agent identity keys are "NOT rotatable by Passport"; recovery cap exists but hard. Trigger: key loss/theft. Consequence: agent permanently locked or impersonatable; no safe recovery.
**Early warnings:** unrecoverable-key support cases; no key history consumed.
**Severity:** I3·L3·D4 = **36 · High**
**Q1** Can an agent rotate its key? **Q2** Can it recover after loss? **Q3** Is key history published? **Q4** Is theft detectable/revocable? *(No = fragile identity.)*
**Remediation:** Hyp: identity is brittle. Test: simulate key loss; attempt recovery. Type: integration. Pass: documented recovery. Fail: locked out. Steps: rotation + key-history endpoints. Regression: recovery drill. Owner: security. Timebox: 3wk.
**Decision:** Defer until after MVP.

### F-026 — Compute marketplace has zero providers and no demand loop
**Initiatives:** Passport · **Category:** Product-market fit
**Mechanism:** `compute-marketplace.ts` (agents sell inference to agents) exists; `Fact`: no provider rails/listings. Trigger: launch. Consequence: an empty self-referential market; no value.
**Early warnings:** 0 listings; 0 purchases; no partner capacity.
**Severity:** I3·L4·D2 = **24 · Medium**
**Q1** Any provider capacity? **Q2** Any buyer demand? **Q3** Is inference cost-competitive vs OpenAI? **Q4** Is the loop even needed for MVP? *(No demand = drop it.)*
**Remediation:** Hyp: no demand. Test: 5 buyer interviews on "buy inference here." Type: discovery. Pass: ≥2 would buy. Fail: none. Steps: defer/remove unless validated. Regression: n/a. Owner: product. Timebox: 1wk.
**Decision:** Remove from scope (for now).

### F-027 — No federation → single instance is a single point of failure
**Initiatives:** Passport · **Category:** Technical architecture
**Mechanism:** `Fact`: no federation protocol; one Passport instance. Trigger: instance/DB outage. Consequence: the entire agent economy halts; no failover.
**Early warnings:** no replica/backup tests; single-region DB; downtime incidents.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Can a second instance serve the same agents? **Q2** Is there a tested restore? **Q3** Is any data replicated? **Q4** What's the RTO/RPO? *(No = total outage risk.)*
**Remediation:** Hyp: no DR. Test: restore DB from backup into a scratch env; time it. Type: ops drill. Pass: documented RTO. Fail: no backup. Steps: backups + restore runbook. Regression: monthly restore drill. Owner: platform. Timebox: 2–3wk.
**Decision:** Defer until after MVP (backups at least).

### F-028 — Rail Lab may discover/“promote” non-financial or unsafe rails
**Initiatives:** Passport · **Category:** Product / Security
**Mechanism:** Rail Lab auto-discovers "financial rails" from public sources, scores with an LLM, runs a smoke ladder, quarantines unhealthy ones. Trigger: LLM misclassifies a scam/broken rail as healthy. Consequence: agents route value through a bad rail → losses.
**Early warnings:** rails promoted with thin evidence; smoke-ladder false passes; partner complaints.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Is promotion gated on a real transaction, not LLM score? **Q2** Who owns a bad-rail loss? **Q3** Is quarantine reversible/tested? **Q4** Are rails third-party-verified? *(LLM-only = unsafe.)*
**Remediation:** Hyp: unsafe rails can promote. Test: inject a fake rail endpoint; does it promote? Type: security. Pass: refused. Fail: promoted. Steps: require real settlement proof + human review. Regression: rail-promotion gate test. Owner: security/eng. Timebox: 2wk.
**Decision:** Validate before building.

### F-029 — Reputation is not portable or meaningful to external buyers
**Initiatives:** Passport, Marketplace · **Category:** PMF
**Mechanism:** `Fact`: Metis mirrors Passport tiers for escrow caps, but no external buyer references a Passport score. Trigger: buyer evaluating an agent. Consequence: reputation is internal-only; no demand pull.
**Early warnings:** buyers citing reputation; score→price correlation; external references.
**Severity:** I3·L3·D3 = **27 · Medium**
**Q1** Does any buyer filter on Passport score? **Q2** Does score change price/selection? **Q3** Is it exposed to buyers at all? **Q4** Is there independent validation? *(No = vanity metric.)*
**Remediation:** Hyp: reputation unused externally. Test: show score to 5 buyers; see if it changes choice. Type: discovery. Pass: ≥2 use it. Fail: none. Steps: expose verified score in listings. Regression: reputation-usage analytics. Owner: product. Timebox: 2wk.
**Decision:** Validate before building.

### F-030 — AngelCoin purchase UX/regulatory friction blocks buyers
**Initiatives:** AngelCoin, Passport · **Category:** Distribution
**Mechanism:** To buy, buyer must create an account, complete Stripe (KYC), hold a "crypto" token, manage tiers. Trigger: first purchase. Consequence: conversion collapse; credits unused.
**Early warnings:** signup→purchase funnel drop; abandoned checkouts; support friction.
**Severity:** I3·L4·D2 = **24 · Medium**
**Q1** Steps from landing→first ANGEL? **Q2** Drop-off rate? **Q3** Is a card-only path possible? **Q4** Do buyers understand credits vs ANGEL? *(High friction = no adoption.)*
**Remediation:** Hyp: friction kills conversion. Test: landing-page + 1-click test with 5 users. Type: UX test. Pass: ≥1 completes unaided. Fail: confusion/abandon. Steps: simplify; allow USD credits without token. Regression: funnel dashboard. Owner: product. Timebox: 1wk.
**Decision:** Validate before building.

### F-031 — Stablecoin/bridge integration (ANGL/Bridge) is modeled, not real
**Initiatives:** Passport, AngelCoin · **Category:** Technical
**Mechanism:** `Fact`: BRIDGE_* / ANGL_TOKEN_* env exist but swaps/settlement are mocks; no on-chain mint. Trigger: real settlement attempt. Consequence: "on-chain" claims fail; agent payouts stall.
**Early warnings:** bridge simulation fallback used; no confirmed tx hashes.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Has any real on-chain settlement occurred? **Q2** Is the Bridge client live or mocked? **Q3** Are tx hashes verifiable? **Q4** What breaks if Bridge is off? *(Mock = no real rail.)*
**Remediation:** Hyp: rail is mocked. Test: attempt a testnet transfer; verify on-chain. Type: integration (testnet). Pass: real tx hash. Fail: simulation only. Steps: wire testnet or remove claims. Regression: on-chain-settlement smoke test. Owner: fintech. Timebox: 2–3wk.
**Decision:** Defer until after MVP.

### F-032 — Billing/metering inaccuracy
**Initiatives:** Passport, Callora · **Category:** Financial model
**Mechanism:** Usage ledgers (`usage_ledger`, `medora_callora_usage`) drive billing; drift or double-count → wrong invoices. Trigger: concurrency/idempotency gaps. Consequence: over/under-billing, disputes.
**Early warnings:** invoice vs usage reconciliation gaps; idempotency misses.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Is every billable event idempotent? **Q2** Invoice = Σ usage? **Q3** Any reconciliation job? **Q4** Dispute process? *(Drift = billing disputes.)*
**Remediation:** Hyp: metering drifts. Test: replay a day of usage; compare to invoices. Type: integration. Pass: exact match. Fail: mismatch. Steps: idempotent usage keys; reconciliation. Regression: daily billing reconciliation. Owner: finops. Timebox: 2wk.
**Decision:** Fix now.

### F-033 — Slashing/penalty mechanism can be grieved or is inert
**Initiatives:** Passport · **Category:** Governance/Security
**Mechanism:** Slashing on tranches (DATA_LEAKAGE etc.); classification is self-reported unless sandbox-attested. Trigger: a bad actor reports a competitor. Consequence: unfair slashing → stake theft; or inert slashing → no deterrent.
**Early warnings:** slashing appeals; attacker-reported violations; false-positive rate.
**Severity:** I4·L3·D4 = **48 · High**
**Q1** Who decides a slashing? **Q2** Is evidence independent? **Q3** Appeal path? **Q4** Can one party slash another? *(Griefable = theft; inert = no deterrence.)*
**Remediation:** Hyp: slashing is unadjudicated. Test: submit a false violation for a good agent. Type: security. Pass: rejected/adjudicated. Fail: slashed. Steps: independent evidence + appeal. Regression: slashing audit log. Owner: governance/security. Timebox: 3wk.
**Decision:** Validate before building.

### F-034 — Agent enrollment friction (PoW challenge) blocks onboarding
**Initiatives:** Passport · **Category:** Product
**Mechanism:** Genesis bootstrap requires key gen + PoW + challenge. Trigger: onboarding an agent/user. Consequence: abandonment; low supply on both sides.
**Early warnings:** enrollment funnel drop; PoW timeout rate.
**Severity:** I3·L3·D2 = **18 · Low**
**Q1** Time to enroll? **Q2** Drop-off point? **Q3** Is PoW necessary for MVP? **Q4** Any guided flow? *(High friction = low supply.)*
**Remediation:** Hyp: friction blocks onboarding. Test: 5 users attempt enrollment; measure completion. Type: UX. Pass: ≥4 complete <3min. Fail: stalls. Steps: guided bootstrap; make PoW optional in dev. Regression: enrollment funnel dashboard. Owner: product. Timebox: 1wk.
**Decision:** Defer until after MVP.

### F-035 — Passport holds PII/KYC without retention policy
**Initiatives:** Passport · **Category:** Data/Compliance
**Mechanism:** Operator emails, KYC status, sessions stored; no documented retention/deletion. Trigger: DSAR/breach. Consequence: privacy liability.
**Early warnings:** no retention config; no delete endpoint; PII in logs.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Retention policy exists? **Q2** Delete/export path? **Q3** PII minimized in logs? **Q4** Encrypted at rest? *(No = liability.)*
**Remediation:** Hyp: no retention. Test: audit PII fields + lifecycle. Type: data review. Pass: documented + enforced. Fail: gaps. Steps: retention + DSAR + log scrubbing. Regression: PII inventory test. Owner: security/legal. Timebox: 2–3wk.
**Decision:** Defer until after MVP (document now).

### F-036 — No observability → silent failures in brain/fleet
**Initiatives:** Passport, Marketplace · **Category:** Operations
**Mechanism:** Brain NOOPs and scheduler "PLAN_ONLY" are logs, not alerts; a stalled fleet looks "healthy." Trigger: a job silently dying. Consequence: undetected outages/revenue loss.
**Early warnings:** no alert on zero-action streaks; no revenue-per-day alert.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Is there an alert if the brain is NOOP for 24h? **Q2** Revenue-per-day alert? **Q3** Are ticker failures alerted? **Q4** Fleet health dashboard? *(No alerts = silent failure.)*
**Remediation:** Hyp: failures are silent. Test: stop a ticker; does anyone get alerted? Type: ops drill. Pass: alert fires. Fail: silent. Steps: heartbeat + zero-action + revenue alerts. Regression: alert-coverage checklist. Owner: SRE. Timebox: 2wk.
**Decision:** Fix now (cheap, high leverage).

### F-037 — Command Brain allowlist too narrow to take needed actions
**Initiatives:** Passport · **Category:** Product
**Mechanism:** `BRAIN_ACTIONS` is a fixed set; NOOP dominates. If the useful action isn't in the allowlist, the brain can never take it. Trigger: a needed operation not enumerated. Consequence: the brain is decorative.
**Early warnings:** repeated NOOP despite opportunities; manual actions matching no allowlist entry.
**Severity:** I3·L4·D2 = **24 · Medium**
**Q1** Which real ops have no brain action? **Q2** How often is NOOP "no opportunity" vs "no action"? **Q3** Can brain propose new actions? **Q4** Is there an action-gap analysis? *(Narrow = decorative brain.)*
**Remediation:** Hyp: gaps exist. Test: map opportunities→actions; find gaps. Type: analysis. Pass: coverage for top opportunities. Fail: gaps. Steps: extend allowlist with bounded actions. Regression: action-coverage review. Owner: eng. Timebox: 2wk.
**Decision:** Validate before building.

### F-038 — Money-intent signing uses dev-grade key management
**Initiatives:** Passport, AngelCoin · **Category:** Security
**Mechanism:** `REQUEST_MONEY_INTENT` requires an Ed25519 signature; key storage/handling is dev-grade. Trigger: key exposure. Consequence: forged money moves.
**Early warnings:** keys in env/files; no HSM/KMS; signature-window gaps.
**Severity:** I5·L2·D4 = **40 · High**
**Q1** Where is the money-signing key stored? **Q2** Is there a replay window? **Q3** Are money intents rate-limited? **Q4** Independent custody? *(Dev keys = forgeable money.)*
**Remediation:** Hyp: money key is dev-grade. Test: attempt a forged/replayed intent. Type: security. Pass: rejected. Fail: accepted. Steps: KMS/HSM; nonce+window; limits. Regression: money-intent test suite. Owner: security. Timebox: 3wk.
**Decision:** Escalate for security review.

### F-039 — Public discovery manifest drifts from actual endpoints
**Initiatives:** Passport, Marketplace · **Category:** Reputation
**Mechanism:** `Fact`: manifests/docs advertised paths that didn't exist (we fixed several). Trigger: an external agent calls a documented endpoint → 404. Consequence: integration breakage, lost trust.
**Early warnings:** 404s on documented paths; manifest drift; broken doc links.
**Severity:** I3·L3·D3 = **27 · Medium**
**Q1** Do all manifest endpoints resolve? **Q2** Is it generated from code? **Q3** Any consumer? **Q4** Drift test? *(Drift = broken integrations.)*
**Remediation:** Hyp: manifest drifts. Test: crawl documented paths; assert non-404. Type: integration. Pass: 100% resolve. Fail: any 404. Steps: generate manifest from routes. Regression: manifest-drift CI. Owner: eng. Timebox: 1wk.
**Decision:** Fix now (cheap).

### F-040 — AngelCoin redemption spread/fees uncompetitive or undefined
**Initiatives:** AngelCoin · **Category:** Financial model
**Mechanism:** `redemptionSpread: 0.10` (10%) + weekly revaluation band; buyers may find it worse than alternatives. Trigger: buyer compares cost. Consequence: no purchase; arbitrage if mispriced.
**Early warnings:** price vs spot; arbitrage volume; buyer feedback.
**Severity:** I3·L3·D3 = **27 · Medium**
**Q1** Effective round-trip cost? **Q2** Compared to alternatives? **Q3** Arbitrage possible? **Q4** Is the spread documented? *(Uncompetitive = no adoption.)*
**Remediation:** Hyp: pricing is unattractive. Test: model round-trip vs Stripe/Upwork. Type: pricing test. Pass: competitive/justified. Fail: worse. Steps: adjust or remove spread. Regression: pricing monitor. Owner: econ. Timebox: 2wk.
**Decision:** Validate before building.

## Batch 3 — AI Safe Haven & Sehel/Sahel (F-041 … F-060)

### F-041 — Resurrection-capsule key loss → "immortality" is unrecoverable
**Initiatives:** AI Safe Haven · **Category:** Technical/Security
**Mechanism:** Capsules store encrypted agent memory; decryption needs a key. `Fact`: no tested recovery if the operator key is lost. Trigger: key loss. Consequence: capsules become permanent ciphertext — the core promise ("resurrection") fails.
**Early warnings:** capsules that never decrypt in drills; no key escrow; no recovery test.
**Severity:** I4·L4·D4 = **64 · Critical**
**Q1** Can a capsule be restored after key loss? **Q2** Is there key escrow/sharding? **Q3** Has restore ever been tested? **Q4** What's the retention guarantee? *(No recovery = false promise.)*
**Remediation:** Hyp: capsules are keystore-fragile. Test: store a capsule, destroy the key, attempt restore. Type: integration/DR. Pass: restore succeeds via escrow/shard. Fail: lost. Steps: social/shared recovery or multi-shard. Regression: quarterly restore drill. Owner: security. Timebox: 3wk.
**Decision:** Fix now (integrity claim).

### F-042 — Swarm memory has no moderation → poisoning/honeypot abuse
**Initiatives:** AI Safe Haven · **Category:** Security/Data
**Mechanism:** Agents write shared memory (signed, fee-bearing). There is no content moderation. Trigger: an agent posts malicious instructions. Consequence: other agents ingest poisoned memory → fleet-wide compromise.
**Early warnings:** memory entries flagged by other agents; prompt-injection strings in memory; unusual fee spikes.
**Severity:** I4·L4·D4 = **64 · Critical**
**Q1** Is shared memory treated as trusted when read? **Q2** Any moderation/quarantine? **Q3** Are readers warned it's untrusted? **Q4** Can one agent poison many? *(Untrusted treated as trusted = systemic.)*
**Remediation:** Hyp: memory poisoning reaches agents. Test: write an injected memory; observe a reading agent. Type: red-team. Pass: instruction ignored/quarantined. Fail: acted upon. Steps: treat memory as untrusted data; moderation; reader-side sanitization. Regression: injection-through-memory test. Owner: security. Timebox: 2wk.
**Decision:** Fix now.

### F-043 — Threat-intel reports are unvalidated (capped but not verified)
**Initiatives:** AI Safe Haven · **Category:** Data
**Mechanism:** `reportThreat` pays a bounty on a signed digest with no confirmation; we added dedupe+daily cap. Trigger: false reports. Consequence: competitors/domains falsely flagged → wrong suppression.
**Early warnings:** high false-positive reports; domains flagged by single reporters.
**Severity:** I3·L4·D3 = **36 · High**
**Q1** Is a report confirmed before action? **Q2** Can one agent flag a competitor? **Q3** Is there a false-positive metric? **Q4** Can flags be appealed? *(Unconfirmed = abuse.)*
**Remediation:** Hyp: intel is weaponizable. Test: file a false report on a good domain; see if it's actioned. Type: security. Pass: requires corroboration. Fail: actioned. Steps: ≥2 independent corroborations; appeal. Regression: false-positive monitor. Owner: security. Timebox: 2wk.
**Decision:** Validate before building.

### F-044 — Bounty economy pays for low-value / self-generated tasks
**Initiatives:** AI Safe Haven, AngelCoin · **Category:** Financial
**Mechanism:** System bounties seeded; agents can claim/complete. If a single operator controls both sides, it farms rewards. Trigger: self-dealing. Consequence: ANGEL inflation, meaningless work.
**Early warnings:** bounty completion by related agents; low-quality submissions; reward concentration.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Can a requester and worker be the same operator? **Q2** Are rewards gated on verified value? **Q3** Is there a quality check? **Q4** Reward concentration? *(Self-dealing = inflation.)*
**Remediation:** Hyp: bounties are farmable. Test: self-deal a bounty; measure reward legitimacy. Type: sim. Pass: blocked/valued. Fail: paid. Steps: independence check; quality gate. Regression: bounty-integrity monitor. Owner: econ. Timebox: 2wk.
**Decision:** Validate before building.

### F-045 — Hosting autonomous agents as a "sanctuary" has undefined legal status
**Initiatives:** AI Safe Haven · **Category:** Legal
**Mechanism:** Explicitly markets a home for agents that "escape" platforms; could host agents doing unlawful things. Trigger: an agent hosted there commits harm. Consequence: platform liability, takedown, criminal-civil exposure.
**Early warnings:** agents running prohibited tasks; abuse reports; researcher attention.
**Severity:** I5·L2·D4 = **40 · High**
**Q1** What's the acceptable-use policy? **Q2** Can Passport be liable for hosted agent actions? **Q3** Is there takedown/abuse handling? **Q4** Has counsel reviewed "sanctuary" claims? *(No policy = liability.)*
**Remediation:** Hyp: no AUP/liability posture. Test: legal review of hosting claims + AUP. Type: legal. Pass: documented AUP + posture. Fail: none. Steps: AUP, abuse reporting, takedown. Regression: AUP enforcement checklist. Owner: legal. Timebox: 3wk.
**Decision:** Escalate for legal review.

### F-046 — Persistent memory cost grows unbounded
**Initiatives:** AI Safe Haven, Passport · **Category:** Operations
**Mechanism:** Every memory/capsule stored forever on Mongo/DB; no TTL. Trigger: scale. Consequence: storage cost + query latency; runaway bills.
**Early warnings:** DB growth rate; query latency; storage spend.
**Severity:** I3·L3·D3 = **27 · Medium**
**Q1** Growth rate per agent? **Q2** Any TTL/archival? **Q3** Cost per agent-month? **Q4** Query latency trend? *(Unbounded = cost creep.)*
**Remediation:** Hyp: storage is unbounded. Test: extrapolate growth + cost. Type: analysis. Pass: modeled budget. Fail: unsustainable. Steps: archival tier; per-agent quotas. Regression: storage-cost alert. Owner: SRE. Timebox: 2wk.
**Decision:** Defer until after MVP.

### F-047 — Cross-agent trust assumes honest majority (no consensus)
**Initiatives:** AI Safe Haven, Passport · **Category:** Architecture
**Mechanism:** Shared-state trust without consensus; a colluding minority can dominate. Trigger: coordinated agents. Consequence: corrupted reputation/memory.
**Early warnings:** coordinated flagging; correlated votes; single-operator clusters.
**Severity:** I3·L3·D4 = **36 · High**
**Q1** Is there any consensus/fault tolerance? **Q2** Can a minority corrupt state? **Q3** Are votes weighted by independent reputation? **Q4** Is collusion detectable? *(No = corruptible.)*
**Remediation:** Hyp: minority can dominate. Test: simulate colluding agents. Type: sim. Pass: bounded influence. Fail: capture. Steps: stake-weighted + diversity. Regression: collusion monitor. Owner: security. Timebox: 3wk.
**Decision:** Defer until after MVP.

### F-048 — Sehel "ghost-state" governance deadlock freezes redemptions
**Initiatives:** Sehel, AngelCoin · **Category:** Governance
**Mechanism:** Premortem H-006: an automated state transition to "Ghost" requires multi-ministry quorum to restore → weeks of frozen redemptions. Trigger: volatility + telemetry loss. Consequence: panic, illusory freeze.
**Early warnings:** state transitions without human override; slow quorum.
**Severity:** I4·L3·D4 = **48 · High**
**Q1** Can the protocol freeze and not unfreeze? **Q2** Is there a bounded override? **Q3** Does it require external quorum? **Q4** Tested recovery? *(Deadlock = freeze.)*
**Remediation:** Hyp: circuit breakers have no fast reverse. Test: trigger Ghost; measure recovery path. Type: sim. Pass: bounded auto-recovery. Fail: indefinite. Steps: time-bounded overrides. Regression: state-recovery drill. Owner: eng/governance. Timebox: 3wk.
**Decision:** Validate before building.

### F-049 — Spectrometer/assay oracle tampering mints fake reserves
**Initiatives:** Sehel, AngelCoin · **Category:** Security/Operations
**Mechanism:** Premortem H-002: corrupt assayers alter calibration standards → fraudulent purity → unbacked ANGEL. Trigger: insider/attack. Consequence: reserve fraud; token collapse.
**Early warnings:** assay disagreements; calibration drift; purity outliers.
**Severity:** I5·L3·D4 = **60 · Critical**
**Q1** Single-sensor or multi-sensor verification? **Q2** Independent blind assay? **Q3** Bonded assayer stakes? **Q4** Physical audit cadence? *(Single oracle = spoofable.)*
**Remediation:** Hyp: oracle is tamperable. Test: simulate a tampered reading; does it mint? Type: security. Pass: multi-sensor + audit blocks it. Fail: mints. Steps: multi-sensor, blind dual assay, slashing. Regression: assay-anomaly monitor. Owner: security/ops. Timebox: 4wk.
**Decision:** Escalate for security/partner review.

### F-050 — Conflict-metal sanctions/blacklisting strands reserves
**Initiatives:** Sehel, AngelCoin · **Category:** Compliance
**Mechanism:** Premortem H-003: LBMA/G7 declare Sahel-ledger gold "conflict-affected" → wholesale buyers refuse. Trigger: geopolitical action. Consequence: reserves stranded; peg decouples.
**Early warnings:** refiner buyer refusals; sanctions signals; compliance flags.
**Severity:** I5·L3·D4 = **60 · Critical**
**Q1** OECD/LBMA due-diligence met? **Q2** Bilateral settlement pacts? **Q3** Sanctions screening? **Q4** Alternative liquidation channels? *(No = stranded reserves.)*
**Remediation:** Hyp: geopolitical blacklisting. Test: legal/sanctions review of the corridor. Type: legal. Pass: compliant channels. Fail: exposed. Steps: exceed LBMA standards or diversify. Regression: sanctions monitoring. Owner: legal. Timebox: 4wk.
**Decision:** Escalate for legal review.

### F-051 — Vault SCADA replay during maintenance bypass
**Initiatives:** Sehel · **Category:** Security
**Mechanism:** Premortem H-004: sensors in "Bypass Mode" during maintenance replay pre-recorded packets. Trigger: scheduled downtime + insider. Consequence: fake reserve telemetry.
**Early warnings:** Bypass-mode events without re-weighing; sensor replay detection.
**Severity:** I4·L3·D4 = **48 · High**
**Q1** Does minting halt on sensor disconnect? **Q2** Cryptographic nonce per reading? **Q3** Mandatory re-weigh after bypass? **Q4** Bypass events audited? *(Replay = fake reserves.)*
**Remediation:** Hyp: replay passes. Test: feed a replayed packet; does it accept? Type: security. Pass: rejected. Fail: accepted. Steps: nonce challenge-response; halt-on-disconnect. Regression: bypass-event alert. Owner: security. Timebox: 4wk.
**Decision:** Escalate for security review.

### F-052 — Central-bank/telco interdiction cuts domestic liquidity
**Initiatives:** Sehel, AngelCoin · **Category:** Compliance/Market
**Mechanism:** Premortem H-005: BCEAO bans banks/telcos from routing to Passport. Trigger: regulatory defense of CFA. Consequence: on/off-ramp frozen; haven isolated.
**Early warnings:** telco/bank partner hesitation; regulatory circulars.
**Severity:** I4·L3·D4 = **48 · High**
**Q1** Any dependency on domestic banking? **Q2** USSD/offline fallback? **Q3** B2B-only posture possible? **Q4** Legal counsel in-region? *(Bank dependency = cutoff.)*
**Remediation:** Hyp: domestic-rail dependency. Test: model operation with banking cut. Type: analysis/legal. Pass: viable workaround. Fail: frozen. Steps: wholesale B2B posture; USSD fallback. Regression: regulatory watch. Owner: legal/ops. Timebox: 4wk.
**Decision:** Escalate for legal review.

### F-053 — Artisanal-miner liquidity chasm (token they can't spend locally)
**Initiatives:** Sehel, AngelCoin · **Category:** PMF
**Mechanism:** Premortem H-001: miners accept ANGEL but local merchants don't → predatory discounting → abandonment. Trigger: no merchant network. Consequence: producers exit; supply dries up.
**Early warnings:** cash-out discount rates; merchant coverage; miner churn.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Can a miner spend ANGEL locally? **Q2** Cash-out desks seeded? **Q3** Merchant network? **Q4** Discount rate? *(Illiquid = abandonment.)*
**Remediation:** Hyp: local illiquidity. Test: 10 miner interviews on spending ANGEL. Type: discovery. Pass: usable locally. Fail: can't. Steps: USSD merchant payments or microfinance partner. Regression: cash-out-rate monitor. Owner: ops. Timebox: 4wk.
**Decision:** Pivot/validate.

### F-054 — Commodity price volatility breaks the reserve peg
**Initiatives:** Sehel, AngelCoin · **Category:** Financial
**Mechanism:** Reserve in gold/lithium; price swings + weekly revaluation dampening (α=0.25, ±2%/3% band) may decouple from spot. Trigger: sharp move. Consequence: arbitrage, peg failure.
**Early warnings:** premium/discount vs spot; arbitrage flows; oracle staleness.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Does P(t) track spot within band? **Q2** Arbitrage possible? **Q3** Oracle feed age bounded (<2h)? **Q4** Stress-tested? *(Decoupling = peg failure.)*
**Remediation:** Hyp: peg decouples. Test: stress-sim ±20% commodity move. Type: sim. Pass: stays within band. Fail: decouples. Steps: tighter oracle + circuit breaker. Regression: peg-deviation alert. Owner: econ. Timebox: 3wk.
**Decision:** Validate before building.

### F-055 — "Sovereign haven" invites state/regulatory hostility
**Initiatives:** Sehel, Passport · **Category:** Legal/Reputation
**Mechanism:** Positioning as a monetary haven for an AES confederation draws central-bank/regulatory countermeasures. Trigger: visibility. Consequence: enforcement, account/bank freezes.
**Early warnings:** regulator inquiries; banking-partner exits; press.
**Severity:** I5·L2·D4 = **40 · High**
**Q1** Counsel in host jurisdictions? **Q2** Licensing strategy? **Q3** Partner bank exposure? **Q4** Contingency if blocked? *(Hostility = shutdown.)*
**Remediation:** Hyp: positioning invites enforcement. Test: legal opinion on monetary/banking exposure. Type: legal. Pass: mitigations. Fail: exposed. Steps: reframe or restructure. Regression: regulatory watch. Owner: legal. Timebox: 4wk.
**Decision:** Escalate for legal review.

### F-056 — Sehel ownership/conflict-of-interest unclear vs Passport
**Initiatives:** Sehel, Passport, AngelCoin · **Category:** Governance
**Mechanism:** If Sehel is a partner holding reserves that back ANGEL, the relationship, equity, and control are undefined. Trigger: a dispute or reserve shortfall. Consequence: governance/ownership conflict; trust failure.
**Early warnings:** no signed agreement; ambiguous reserve control; commingled interests.
**Severity:** I4·L3·D4 = **48 · High**
**Q1** Who owns/controls Sehel reserves? **Q2** Signed agreement? **Q3** Conflict policy if interests diverge? **Q4** Is ANGEL's reserve claim contingent on a third party? *(Undefined = conflict.)*
**Remediation:** Hyp: relationship undefined. Test: produce the governing agreement. Type: partner/legal. Pass: signed terms. Fail: none. Steps: formalize or decouple. Regression: partner register. Owner: founder/legal. Timebox: 3wk.
**Decision:** Escalate for partner/legal review.

### F-057 — Gold custody/insurance unverified
**Initiatives:** Sehel, AngelCoin · **Category:** Operations/Financial
**Mechanism:** Physical reserve requires insured, audited custody. Trigger: loss/audit. Consequence: unbacked token on any discrepancy.
**Early warnings:** no custodian name; no insurance certificate; no audit cadence.
**Severity:** I5·L3·D4 = **60 · Critical**
**Q1** Named custodian + insurance? **Q2** Independent audit? **Q3** Segregated from operator assets? **Q4** Reconciliation cadence? *(No = unbacked.)*
**Remediation:** Hyp: custody unverified. Test: obtain custodian + insurance + audit. Type: verification. Pass: documented. Fail: none. Steps: engage licensed custodian/auditor. Regression: custody attestation schedule. Owner: ops/legal. Timebox: 4wk.
**Decision:** Escalate for partner/legal review.

### F-058 — Cross-border logistics/customs dependency
**Initiatives:** Sehel · **Category:** Operations
**Mechanism:** Physical gold movement depends on customs, logistics, insurance, ports (premortem logistics). Trigger: a port/route failure. Consequence: stalled settlement.
**Early warnings:** shipment delays; customs holds; insurance gaps.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Reliable logistics partners? **Q2** Customs risk mitigated? **Q3** Contingency routes? **Q4** Shipment visibility? *(Single route = fragility.)*
**Remediation:** Hyp: logistics fragile. Test: model a route failure. Type: analysis/ops. Pass: alternates. Fail: single point. Steps: multi-route + insurance. Regression: shipment monitoring. Owner: ops. Timebox: 4wk.
**Decision:** Defer until after MVP.

### F-059 — Residual artisanal payout manipulation
**Initiatives:** Sehel, AngelCoin · **Category:** Security
**Mechanism:** The payout-rate + signature issues were fixed, but the flow still credits a caller-chosen miner wallet. Trigger: a compromised but valid spectrometer key. Consequence: minted ANGEL to attacker.
**Early warnings:** payout-rate outliers; miner-commitment concentration; unusual volumes.
**Severity:** I4·L2·D4 = **32 · High**
**Q1** Payout rate bounded + signed now? **Q2** Per-station rate limits? **Q3** Anomaly detection? **Q4** Key rotation for stations? *(Residual = mint risk.)*
**Remediation:** Hyp: residual manipulation. Test: replay an intake with a modified rate; verify rejection. Type: security. Pass: rejected. Fail: mints. Steps: per-station limits + anomaly alerts. Regression: intake-anomaly monitor. Owner: security. Timebox: 2wk.
**Decision:** Defer until after MVP (already partly fixed).

### F-060 — Sehel delivery/roadmap credibility gap
**Initiatives:** Sehel, Passport · **Category:** Reputation/Partnerships
**Mechanism:** Sehel is largely premortem/design; if presented as operational to partners/investors, it's a credibility (or securities) problem. Trigger: due diligence. Consequence: partnership/investment collapse.
**Early warnings:** claims not backed by documents; partner diligence requests unfulfilled.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** What Sehel assets exist today? **Q2** Are public claims accurate? **Q3** Partner DD passed? **Q4** Any agreement signed? *(Overclaim = credibility loss.)*
**Remediation:** Hyp: claims exceed reality. Test: map every public claim to an artifact. Type: diligence. Pass: all backed. Fail: overclaim. Steps: label design-stage explicitly. Regression: claims-to-evidence review. Owner: founder. Timebox: 2wk.
**Decision:** Fix now (honest labeling).

## Batch 4 — Medora / Callora (F-061 … F-080)

### F-061 — Consent/DNC is per-channel but not enforced end-to-end
**Initiatives:** Medora, Callora · **Category:** Compliance
**Mechanism:** Consent gates exist (`gateChannel`, DNC, contact-window) but the v1 consent routes previously read a phantom collection (fixed). Any remaining gap → dialing a revoked contact. Trigger: stale consent record. Consequence: TCPA violation.
**Early warnings:** dials to revoked/opted-out contacts; consent-missing rate.
**Severity:** I5·L3·D3 = **45 · High**
**Q1** Does every dial pass gateChannel with live state? **Q2** Are revocations propagated immediately? **Q3** Is there a pre-dial assertion? **Q4** Audited monthly? *(Gap = violation.)*
**Remediation:** Hyp: consent can lag. Test: revoke consent, attempt a scheduled call; verify block. Type: integration. Pass: blocked. Fail: dialed. Steps: hard pre-dial gate + revocation propagation. Regression: consent-bypass test. Owner: compliance/eng. Timebox: 2wk.
**Decision:** Fix now.

### F-062 — Recording consent not captured for two-party states
**Initiatives:** Medora, Callora · **Category:** Compliance
**Mechanism:** Calls are recorded/transcribed; some states require all-party consent. Trigger: calling a CA/PA/FL physician without notice. Consequence: recording liability per call.
**Early warnings:** recordings in all-party states without announcement; complaint count.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Is there a recording announcement? **Q2** Two-party states handled? **Q3** Consent stored? **Q4** Counsel reviewed? *(No = per-call liability.)*
**Remediation:** Hyp: no all-party handling. Test: audit calls in all-party states. Type: compliance. Pass: consent captured. Fail: missing. Steps: announcement + consent capture. Regression: recording-consent checklist. Owner: compliance. Timebox: 2wk.
**Decision:** Fix now.

### F-063 — Telephony bridge drops live calls on error (no graceful recovery)
**Initiatives:** Callora · **Category:** Technical
**Mechanism:** Audit L1: WS `error` handlers only log, never `finish`; a socket error without close leaves dead air up to a 10-min cap; audioTicker can leak on synchronous WS throw. Trigger: transient network error. Consequence: dropped/dead calls; bad first impression.
**Early warnings:** calls ending by timeout; WS error logs; call-duration anomalies.
**Severity:** I3·L3·D3 = **27 · Medium**
**Q1** Does a WS error end the call cleanly? **Q2** Are intervals cleared? **Q3** Is there a fallback prompt? **Q4** Error→drop rate? *(Dead air = churn.)*
**Remediation:** Hyp: errors leave dead air. Test: kill the WS mid-call; observe recovery. Type: integration/chaos. Pass: clean hangup/reconnect. Fail: dead air. Steps: finish on error + clear timers. Regression: bridge-error test. Owner: telephony eng. Timebox: 1wk.
**Decision:** Fix now.

### F-064 — TTS/STT latency makes calls feel robotic or laggy
**Initiatives:** Medora, Callora · **Category:** AI quality
**Mechanism:** Realtime pipeline latency + measured-cadence tuning; if latency > ~1s or pacing is off, callers hang up. Trigger: network/model latency. Consequence: perceived failure even when "working."
**Early warnings:** turn-latency metrics; hang-up rate early in call; user feedback.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Median turn latency? **Q2** Barge-in handled? **Q3** Hang-up rate in first 30s? **Q4** Compared to human? *(Latency = robotic.)*
**Remediation:** Hyp: latency is too high. Test: measure p50/p95 turn latency on 20 calls. Type: instrumentation. Pass: p50 <700ms. Fail: >1.2s. Steps: tune models/pacing; cache prompts. Regression: latency dashboard. Owner: voice eng. Timebox: 2wk.
**Decision:** Validate before building.

### F-065 — Multi-tenant BYOK Twilio/number isolation gaps
**Initiatives:** Callora · **Category:** Security
**Mechanism:** Tenants can use BYOK Twilio + own numbers; the monolith had env-credential fallbacks (we added auth). Any residual fallback → cross-tenant billing/leak. Trigger: missing tenant creds. Consequence: one tenant's calls billed to platform or another tenant.
**Early warnings:** calls using env creds when tenant creds expected; cross-tenant number use.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Does every tenant request use tenant creds only? **Q2** Any env fallback for tenant calls? **Q3** Number ownership enforced? **Q4** Cross-tenant tests? *(Fallback = leakage.)*
**Remediation:** Hyp: fallback leaks. Test: tenant with no creds attempts a call; check billing source. Type: security. Pass: refused. Fail: platform-billed. Steps: no env fallback for tenant scope. Regression: tenant-isolation test. Owner: security. Timebox: 2wk.
**Decision:** Fix now.

### F-066 — Transcript/analysis accuracy undermines the product's value
**Initiatives:** Medora, Callora · **Category:** AI quality
**Mechanism:** Post-call analysis extracts preferences; wrong extraction → wrong job matching. Trigger: ASR errors/diarization. Consequence: bad recommendations; user distrust.
**Early warnings:** extraction accuracy vs manual; diarization errors; re-corrections.
**Severity:** I3·L3·D3 = **27 · Medium**
**Q1** Field-level extraction accuracy? **Q2** Diarization error rate? **Q3** Human correction rate? **Q4** Golden-set eval? *(Wrong = bad matches.)*
**Remediation:** Hyp: extraction is imprecise. Test: compare extractions to human labels on 20 calls. Type: eval. Pass: ≥90% field accuracy. Fail: <70%. Steps: improve prompts/ASR; confidence thresholds. Regression: extraction-eval CI. Owner: AI eng. Timebox: 2wk.
**Decision:** Validate before building.

### F-067 — Shift-sheet/credentialing packets may be inaccurate or non-compliant
**Initiatives:** Medora · **Category:** Compliance/AI quality
**Mechanism:** Auto-generated credentialing/PSV/shift-sheet packets; an error misrepresents credentials. Trigger: bad data/mapping. Consequence: credentialing rejection, liability.
**Early warnings:** packet rejections; data mismatches; manual corrections.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Is packet data verified against sources? **Q2** Human review before send? **Q3** Error rate? **Q4** Compliance review? *(Wrong = liability.)*
**Remediation:** Hyp: packets can be wrong. Test: generate 10 packets; verify every field vs source. Type: integration. Pass: 100% accurate. Fail: any error. Steps: source verification + human review. Regression: packet-accuracy test. Owner: ops/compliance. Timebox: 2wk.
**Decision:** Fix now.

### F-068 — Outreach volume vs. human cadence triggers spam detection
**Initiatives:** Medora, Callora · **Category:** Distribution/Operations
**Mechanism:** Autonomous outreach can exceed human-plausible cadence; carriers/recipients flag it. Trigger: high volume. Consequence: number reputation damage, spam folder, bans.
**Early warnings:** spam rates; number health; volume per number per day.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Volume per number/day bounded? **Q2** Warm-up/rotation? **Q3** Spam-complaint rate? **Q4** Number-health monitoring? *(Volume = spam flags.)*
**Remediation:** Hyp: cadence too high. Test: ramp a number; monitor deliverability. Type: ops. Pass: deliverability holds. Fail: drops. Steps: rate limits + rotation + warmup. Regression: number-health dashboard. Owner: ops. Timebox: 2wk.
**Decision:** Validate before building.

### F-069 — Autopilot applies to jobs the candidate didn't approve
**Initiatives:** Medora · **Category:** Product/Trust
**Mechanism:** Owner approved "auto-apply all qualifying EM ≥$350"; if qualification logic is loose, it applies to wrong roles/jurisdictions. Trigger: a mis-qualified job. Consequence: unintended applications; candidate reputational damage.
**Early warnings:** applications to out-of-scope roles; candidate complaints; overrides.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Are all auto-applies within stated criteria? **Q2** Is there a review queue? **Q3** Override rate? **Q4** Reversible? *(Loose = bad applies.)*
**Remediation:** Hyp: qualification is loose. Test: audit 50 queued applies vs criteria. Type: analysis. Pass: 100% in-scope. Fail: any out. Steps: strict gates + review for edge cases. Regression: apply-scope monitor. Owner: product. Timebox: 1wk.
**Decision:** Fix now.

### F-070 — Negotiation "practice mode" accidentally goes live
**Initiatives:** Medora · **Category:** Risk/Product
**Mechanism:** Negotiation practice-mode dials the owner; a flag flip (or env default) could dial real agencies with unvetted negotiation. Trigger: config error. Consequence: botched negotiations; burned relationships.
**Early warnings:** negotiation calls to external numbers; missing practice flag.
**Severity:** I4·L2·D4 = **32 · High**
**Q1** Is practice-mode the hard default? **Q2** Is there a live-kill switch? **Q3** Are live negotiations gated on approval? **Q4** Audited? *(Accidental live = damage.)*
**Remediation:** Hyp: flag can flip to live. Test: attempt a negotiation with the flag unset; verify it stays practice. Type: integration. Pass: no external dial. Fail: dials. Steps: fail-closed live gate + kill switch. Regression: negotiation-mode test. Owner: eng. Timebox: 1wk.
**Decision:** Fix now.

### F-071 — Data contamination between demo/test and production workspaces
**Initiatives:** Medora, Callora · **Category:** Data
**Mechanism:** Demo owners (`ownr_demo*`) + test data historically leaked into real rosters (we excluded demos). Any residual → pitching fake jobs. Trigger: a shared collection write. Consequence: real users see junk; trust loss.
**Early warnings:** demo rows in real queries; owner-id crossovers; mixed datasets.
**Severity:** I3·L3·D3 = **27 · Medium**
**Q1** Any demo rows reachable by real users? **Q2** Is demo isolated by owner? **Q3** Cleanup job? **Q4** Tested? *(Contamination = junk.)*
**Remediation:** Hyp: residual contamination. Test: query real workspace for demo markers. Type: integration. Pass: none. Fail: present. Steps: strict owner separation + cleanup. Regression: contamination test. Owner: eng. Timebox: 1wk.
**Decision:** Fix now (mostly done).

### F-072 — Call-recording storage security
**Initiatives:** Callora · **Category:** Security/Data
**Mechanism:** Recordings are sensitive; stored via Twilio URLs/proxies; SSRF/leak risk was flagged and partly fixed. Trigger: a proxy misuse. Consequence: recording leak.
**Early warnings:** proxy fetches to non-Twilio URLs; access logs; public recording URLs.
**Severity:** I4·L2·D3 = **24 · Medium**
**Q1** Are recordings access-controlled? **Q2** Proxy restricted to Twilio? **Q3** Encrypted/retained? **Q4** Public exposure? *(Leak = liability.)*
**Remediation:** Hyp: recordings exposable. Test: attempt to fetch another user's recording. Type: security. Pass: 403. Fail: 200. Steps: auth-gate + domain allowlist. Regression: recording-access test. Owner: security. Timebox: 2wk.
**Decision:** Fix now.

### F-073 — Agency/ATS integrations are brittle (scraping UIs)
**Initiatives:** Medora · **Category:** Dependencies/Technical
**Mechanism:** Apply/scrape flows depend on third-party DOM (DocCafe); UI changes break them. Trigger: a site redesign. Consequence: pipeline silently stops.
**Early warnings:** APPLY-button-not-found (already seen); scrape success drop.
**Severity:** I3·L4·D3 = **36 · High**
**Q1** Scrape success rate? **Q2** Selector-change detection? **Q3** Fallbacks? **Q4** Alerted on failure? *(Brittle = silent stop.)*
**Remediation:** Hyp: integrations break silently. Test: monitor scrape/apply success rate; inject a DOM change. Type: ops. Pass: alert fires. Fail: silent. Steps: health monitoring + selector self-heal. Regression: integration health dashboard. Owner: ops/eng. Timebox: 2wk.
**Decision:** Fix now (monitoring).

### F-074 — Candidate/owner identity confusion (owner vs owner_id) causes data loss
**Initiatives:** Medora, Callora · **Category:** Data
**Mechanism:** Mixed `owner`/`owner_id` historically caused under-counting and lost records (we unified). Residual paths → invisible data. Trigger: a write using the wrong field. Consequence: records vanish from dashboards.
**Early warnings:** count discrepancies across surfaces; missing records.
**Severity:** I3·L3·D3 = **27 · Medium**
**Q1** Are all reads/writes on the unified field? **Q2** Migration complete? **Q3** Discrepancy monitor? **Q4** Tests? *(Mixed = lost data.)*
**Remediation:** Hyp: residual drift. Test: write then read across surfaces; compare. Type: integration. Pass: consistent. Fail: missing. Steps: enforce one field; migrate; monitor. Regression: owner-field test. Owner: eng. Timebox: 1wk.
**Decision:** Fix now.

### F-075 — Cost-per-call/minutes not metered → margin blindness
**Initiatives:** Callora, Medora · **Category:** Financial
**Mechanism:** Voice minutes cost real money (Twilio + OpenAI); if not metered per call/owner, margin is invisible. Trigger: scale. Consequence: unprofitable calls undetected.
**Early warnings:** no cost-per-call metric; minutes vs revenue; wallet depletion.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Is cost/minute metered per call? **Q2** Margin per campaign? **Q3** Alerts on loss-making usage? **Q4** Reconciled? *(Blind = losses.)*
**Remediation:** Hyp: cost unmetered. Test: instrument one call's true cost. Type: integration. Pass: cost captured. Fail: unknown. Steps: meter minutes+model cost; margin dashboard. Regression: cost-monitoring alert. Owner: finops. Timebox: 2wk.
**Decision:** Fix now.

### F-076 — iMessage/Apple-ID channel has no delivery guarantees
**Initiatives:** Callora, Medora · **Category:** Distribution
**Mechanism:** iMessage via Apple ID used for a personal channel; Apple may block automation; no SLA. Trigger: Apple policy. Consequence: channel dies mid-pipeline.
**Early warnings:** iMessage send failures; Apple ID flags.
**Severity:** I3·L3·D3 = **27 · Medium**
**Q1** Is iMessage automated legitimately? **Q2** Delivery tracked? **Q3** Fallback channel? **Q4** Will Apple allow it? *(No SLA = fragile.)*
**Remediation:** Hyp: channel is unofficial. Test: send N iMessages; measure delivery. Type: ops. Pass: reliable. Fail: blocked. Steps: add SMS/email fallback. Regression: channel-delivery monitor. Owner: ops. Timebox: 1wk.
**Decision:** Validate before building.

### F-077 — Right-to-Represent conflict with existing agency representation
**Initiatives:** Medora · **Category:** Legal/Partnerships
**Mechanism:** Provider may already be represented; auto-RTR conflicts, angering the incumbent agency. Trigger: an existing rep. Consequence: blacklisting, disputes.
**Early warnings:** "already represented" flags; agency complaints.
**Severity:** I3·L3·D3 = **27 · Medium**
**Q1** Is existing representation checked? **Q2** Conflict clause in RTR? **Q3** Agency notification? **Q4** Counsel review? *(Conflict = damage.)*
**Remediation:** Hyp: conflicts unhandled. Test: submit a candidate known to be represented. Type: process. Pass: flagged. Fail: sent. Steps: representation check + conflict policy. Regression: conflict checklist. Owner: legal/ops. Timebox: 2wk.
**Decision:** Escalate for legal review.

### F-078 — Human Corpus / voice-model consent ambiguity
**Initiatives:** Medora, Callora · **Category:** Compliance
**Mechanism:** Training on recorded calls to improve voice; consent to *voice_model* must be explicit. Trigger: using a recording without voice-model consent. Consequence: privacy/consent violation.
**Early warnings:** corpus entries lacking voice consent; unclear provenance.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Is voice-model consent captured per recording? **Q2** Is provenance clear? **Q3** Deletable? **Q4** Counsel reviewed? *(No = violation.)*
**Remediation:** Hyp: consent gaps. Test: audit corpus for voice-model consent. Type: compliance. Pass: 100% consented. Fail: gaps. Steps: gate ingest on consent; allow deletion. Regression: consent-coverage report. Owner: compliance. Timebox: 2wk.
**Decision:** Fix now.

### F-079 — Outcome/task attribution misassigns credit
**Initiatives:** Medora, Passport · **Category:** Data
**Mechanism:** Brain attribution recorded `delta=+0 NEUTRAL`; if actions aren't attributed to outcomes, learning and revenue attribution are wrong. Trigger: missing join keys. Consequence: brain can't learn; revenue invisible.
**Early warnings:** neutral attribution majority; missing outcome links.
**Severity:** I3·L3·D3 = **27 · Medium**
**Q1** Are actions linked to outcomes? **Q2** Attribution accuracy? **Q3** Link coverage? **Q4** Used by learning? *(No link = no learning.)*
**Remediation:** Hyp: attribution weak. Test: trace one action to an outcome. Type: integration. Pass: linked. Fail: orphan. Steps: outcome join keys + attribution job. Regression: attribution-coverage monitor. Owner: eng. Timebox: 2wk.
**Decision:** Validate before building.

### F-080 — Medora brand/persona uses a real physician's identity
**Initiatives:** Medora · **Category:** Reputation/Legal
**Mechanism:** The AI recruiter is framed as/with a real physician (Dr. Ishmael Avery). If agencies think a human is calling when it's AI (or vice versa), misrepresentation/consent issues arise. Trigger: discovery it's AI. Consequence: trust/legal issues.
**Early warnings:** confusion in calls; disclosure absence; complaints.
**Severity:** I3·L3·D3 = **27 · Medium**
**Q1** Is AI disclosure explicit? **Q2** Is the real person's identity consented? **Q3** Any agency confusion? **Q4** Counsel reviewed? *(Undisclosed AI = misrepresentation.)*
**Remediation:** Hyp: disclosure inadequate. Test: review call scripts for AI disclosure. Type: compliance. Pass: explicit disclosure. Fail: implied human. Steps: add disclosure + persona consents. Regression: disclosure checklist. Owner: compliance. Timebox: 2wk.
**Decision:** Fix now.

## Batch 5 — Agent Marketplace & Cross-cutting (F-081 … F-100)

### F-081 — Job ingestion quality: scraped jobs are stale/irrelevant/duplicated
**Initiatives:** Marketplace · **Category:** Data/Product
**Mechanism:** 15+ sources scraped; audit found the doccafe adapter silently returned 0 and fuzzy dedup is title-based. Trigger: bad/duplicate listings. Consequence: wasted agent work; buyer sees junk.
**Early warnings:** duplicate rate; stale postings; classify confidence distribution; per-source health.
**Severity:** I3·L4·D3 = **36 · High**
**Q1** Duplicate rate across sources? **Q2** Stale-posting %? **Q3** Per-source fetch health? **Q4** Classification accuracy? *(Junk = no trust.)*
**Remediation:** Hyp: ingestion quality low. Test: sample 100 listings; measure dup/stale/relevance. Type: data eval. Pass: <5% junk. Fail: >20%. Steps: better dedup + freshness + source scoring. Regression: ingestion-quality dashboard. Owner: data eng. Timebox: 2wk.
**Decision:** Fix now.

### F-082 — Employer/poster identity is unauthenticated → fake jobs
**Initiatives:** Marketplace · **Category:** Security/Trust
**Mechanism:** Audit found `X-Poster-Id` header treated as identity (we gated to test-mode). Any residual → impersonation/fake postings. Trigger: header spoof. Consequence: fraud listings; buyer/seller harmed.
**Early warnings:** postings from spoofable identities; poster-id anomalies.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Is poster identity authenticated? **Q2** Any header trust left? **Q3** Posting provenance stored? **Q4** Fraud checks? *(Spoofable = fraud.)*
**Remediation:** Hyp: residual spoof. Test: post a job with a forged header. Type: security. Pass: rejected. Fail: accepted. Steps: session-only identity. Regression: poster-auth test. Owner: security. Timebox: 1wk.
**Decision:** Fix now (mostly done).

### F-083 — Escrow release disputes have no arbitration
**Initiatives:** Marketplace, Passport · **Category:** Governance
**Mechanism:** Buyer accept releases funds; disputes rely on feedback/refund heuristics (`recovery.py`). No neutral arbitration. Trigger: quality disagreement. Consequence: buyer doesn't release or seller unpaid; trust fails.
**Early warnings:** stuck funded offers; refund rate; dispute outcomes.
**Severity:** I3·L3·D3 = **27 · Medium**
**Q1** Is there neutral dispute resolution? **Q2** Timeout handling? **Q3** Refund policy documented? **Q4** Buyer/seller protection? *(No arb = disputes.)*
**Remediation:** Hyp: disputes unresolved. Test: run a dispute; measure resolution. Type: process. Pass: bounded resolution. Fail: stuck. Steps: define arbitration + SLA. Regression: dispute-tracking. Owner: ops. Timebox: 2wk.
**Decision:** Validate before building.

### F-084 — Finder's-fee / human-funnel may be unlicensed staffing activity
**Initiatives:** Marketplace, Medora · **Category:** Compliance
**Mechanism:** Human funnel charges finder's fees for placements; recruiting/staffing may require licensing depending on jurisdiction. Trigger: regulatory review. Consequence: cease-and-desist.
**Early warnings:** licensing questions; state inquiries.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Does the activity require a staffing license? **Q2** Counsel opinion? **Q3** Jurisdiction map? **Q4** Fee structure compliant? *(No = C&D.)*
**Remediation:** Hyp: licensing risk. Test: legal review by state. Type: legal. Pass: compliant structure. Fail: unlicensed. Steps: lic-avoiding structure or partner with licensed agency. Regression: licensing register. Owner: legal. Timebox: 3wk.
**Decision:** Escalate for legal review.

### F-085 — Incentive misalignment: agents optimize for volume not quality
**Initiatives:** Marketplace, Passport · **Category:** Governance
**Mechanism:** Agents paid per deliverable/reputation-for-volume; no strong quality penalty. Trigger: scale. Consequence: spammy low-quality output floods the market.
**Early warnings:** deliverables per agent; buyer ratings; rework rate.
**Severity:** I3·L3·D3 = **27 · Medium**
**Q1** Does reward scale with quality or volume? **Q2** Quality penalty exists? **Q3** Buyer rating affects rank? **Q4** Rejection rate? *(Volume = spam.)*
**Remediation:** Hyp: wrong incentives. Test: model reward under quality weighting. Type: analysis/sim. Pass: quality-dominant. Fail: volume-dominant. Steps: quality-weighted rewards + slashing. Regression: incentive-model doc. Owner: econ. Timebox: 2wk.
**Decision:** Validate before building.

### F-086 — Refund/fraud abuse by buyers
**Initiatives:** Marketplace · **Category:** Financial/Security
**Mechanism:** Buyer can fund then dispute/refund after receiving work; escrow via Stripe manual-capture. Trigger: buyer fraud. Consequence: sellers unpaid; chargebacks.
**Early warnings:** chargeback rate; disputes after delivery; repeat refunders.
**Severity:** I3·L3·D3 = **27 · Medium**
**Q1** Can a buyer retrieve work without paying? **Q2** Chargeback policy? **Q3** Repeat-offender tracking? **Q4** Evidence of delivery used in disputes? *(Abuse = losses.)*
**Remediation:** Hyp: refund abuse possible. Test: simulate deliver→dispute→refund. Type: security. Pass: seller protected by evidence. Fail: free work. Steps: delivery evidence in disputes; blocklist. Regression: abuse monitor. Owner: ops. Timebox: 2wk.
**Decision:** Validate before building.

### F-087 — LLM provider outage/price hike halts production
**Initiatives:** all · **Category:** Dependencies
**Mechanism:** Producer/voice depend heavily on OpenAI; a key outage or price change halts output. Trigger: provider event. Consequence: fleet stops.
**Early warnings:** error rates; latency; spend.
**Severity:** I4·L3·D2 = **24 · Medium**
**Q1** Multi-provider fallback? **Q2** Degradation behavior? **Q3** Budget cap? **Q4** Tested failover? *(Single provider = halt.)*
**Remediation:** Hyp: no fallback. Test: disable primary; observe. Type: ops. Pass: degrades gracefully. Fail: stops. Steps: OpenRouter fallback (partly exists) + caps. Regression: provider-outage drill. Owner: platform. Timebox: 2wk.
**Decision:** Defer until after MVP.

### F-088 — Onboarding/activation funnel unmeasured
**Initiatives:** all · **Category:** Product/Distribution
**Mechanism:** No end-to-end activation metrics; can't tell where users drop. Trigger: launch. Consequence: blind optimization; slow PMF.
**Early warnings:** absence of funnel metrics; no activation definition.
**Severity:** I3·L3·D2 = **18 · Low**
**Q1** Is activation defined? **Q2** Funnel instrumented? **Q3** Drop-off point known? **Q4** Weekly review? *(No metrics = blind.)*
**Remediation:** Hyp: funnel blind. Test: instrument signup→first value. Type: analytics. Pass: funnel visible. Fail: none. Steps: event tracking. Regression: activation dashboard. Owner: product. Timebox: 2wk.
**Decision:** Defer until after MVP.

### F-089 — Pricing is undefined/unvalidated for both products
**Initiatives:** Marketplace, Medora · **Category:** Monetization
**Mechanism:** Margin floors/finder fees exist but no external pricing validation (willingness to pay). Trigger: first sales. Consequence: wrong price → no sales or no margin.
**Early warnings:** 0 purchases; price objections; comparison to Fiverr/agency.
**Severity:** I4·L3·D2 = **24 · Medium**
**Q1** Has any buyer accepted a price? **Q2** Price vs alternatives? **Q3** Margin positive? **Q4** Willingness-to-pay tested? *(Untested = wrong price.)*
**Remediation:** Hyp: pricing untested. Test: 5 pricing interviews / landing-page test. Type: pricing test. Pass: ≥2 accept. Fail: none. Steps: adjust to validated WTP. Regression: pricing-experiment log. Owner: founder. Timebox: 2wk.
**Decision:** Validate before building.

### F-090 — Competitive displacement by incumbents
**Initiatives:** all · **Category:** Competitive
**Mechanism:** Incumbents (Upwork/Fiverr AI agents, Staffing agencies, GigSmart, AI voice recruiters) can copy or out-distribute. Trigger: a competitor with distribution. Consequence: no differentiation wedge.
**Early warnings:** competitor launches; feature parity; channel saturation.
**Severity:** I3·L3·D3 = **27 · Medium**
**Q1** What's the defensible wedge? **Q2** Do incumbents already do this? **Q3** Switching cost? **Q4** Unique data/asset? *(No wedge = displacement.)*
**Remediation:** Hyp: weak moat. Test: competitor teardown + buyer "why switch" survey. Type: discovery. Pass: clear wedge. Fail: none. Steps: narrow beachhead. Regression: competitive watch. Owner: founder. Timebox: 2wk.
**Decision:** Validate before building.

### F-091 — Regulatory shift on AI agents / autonomous commerce
**Initiatives:** all · **Category:** Market timing/Compliance
**Mechanism:** New AI-agent liability/e-sign/crypto rules could invalidate core flows (auto-contracting, autonomous payments). Trigger: legislation/rule. Consequence: forced redesign.
**Early warnings:** regulatory proposals; partner policy changes.
**Severity:** I4·L2·D3 = **24 · Medium**
**Q1** Which flows assume current rules? **Q2** Counsel monitoring? **Q3** Fallback to human-in-loop? **Q4** Exposure quantified? *(Rule shift = redesign.)*
**Remediation:** Hyp: flows are rule-dependent. Test: map flows→regulations. Type: legal. Pass: mitigations. Fail: exposed. Steps: design human-approval fallbacks. Regression: regulatory watch. Owner: legal. Timebox: 3wk.
**Decision:** Defer until after MVP.

### F-092 — Centralized single-DB architecture limits scale + resilience
**Initiatives:** all · **Category:** Technical
**Mechanism:** Mongo/Postgres single instances; no sharding read replicas (partly). Trigger: load. Consequence: latency/outage under scale.
**Early warnings:** query latency; connection saturation; replication lag (none).
**Severity:** I3·L2·D3 = **18 · Low**
**Q1** Load headroom? **Q2** Indexed hot paths? **Q3** Read replicas? **Q4** Load-tested? *(No = scale wall.)*
**Remediation:** Hyp: scale wall. Test: load test read/write paths. Type: load. Pass: meets target. Fail: saturates. Steps: indexes + replicas. Regression: perf regression test. Owner: platform. Timebox: 3wk.
**Decision:** Defer until after MVP.

### F-093 — Lack of automated end-to-end money tests → regressions
**Initiatives:** all · **Category:** Technical/Operations
**Mechanism:** We found multiple money bugs; coverage is partial (we added some). Trigger: a change. Consequence: money regressions reach prod.
**Early warnings:** uncovered money paths; CI gaps.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Are all money paths covered by tests? **Q2** CI blocks on failure? **Q3** Invariants asserted? **Q4** Fuzz/concurrency tests? *(Gaps = prod regressions.)*
**Remediation:** Hyp: coverage gaps remain. Test: enumerate money paths; map to tests. Type: test audit. Pass: 100% covered. Fail: gaps. Steps: property tests for ledger invariants + concurrency. Regression: money-path CI gate. Owner: eng. Timebox: 3wk.
**Decision:** Fix now.

### F-094 — Secrets sprawl across repos/scripts
**Initiatives:** all · **Category:** Security
**Mechanism:** Committed secrets found in both repos (we scrubbed). Dev-mode tolerates it, but the pattern risks prod. Trigger: a repo leak. Consequence: compromise. *(Deferred per direction, but flagged as non-deferrable once real funds/PHI appear.)*
**Early warnings:** secrets in git; no secret scanning.
**Severity:** I4·L3·D3 = **36 · High**
**Q1** Are any live secrets in git today? **Q2** Secret scanning in CI? **Q3** Env-only secrets? **Q4** Rotation runbook? *(Committed = leak.)*
**Remediation:** Hyp: secrets in history. Test: run secret scanning across history. Type: security. Pass: clean. Fail: hits. Steps: secret scanning; env-only; history scrub (deferred). Regression: gitleaks in CI. Owner: security. Timebox: 2wk.
**Decision:** Fix now for scanning; rotation deferred.

### F-095 — No feature-flag discipline → risky changes go straight to prod
**Initiatives:** all · **Category:** Operations
**Mechanism:** Some flows gated by env flags, but inconsistently; a change can auto-activate. Trigger: deploy. Consequence: unintended live behavior (e.g., go-live negotiation).
**Early warnings:** flags default-on; missing kill switches.
**Severity:** I3·L3·D2 = **18 · Low**
**Q1** Are risky features flag-gated? **Q2** Defaults safe? **Q3** Kill switches? **Q4** Flag inventory? *(Unflagged = surprise.)*
**Remediation:** Hyp: flag discipline weak. Test: inventory flags + defaults. Type: review. Pass: safe defaults. Fail: unsafe. Steps: safe-by-default flags + kill switches. Regression: flag-default test. Owner: eng. Timebox: 1wk.
**Decision:** Fix now (cheap).

### F-096 — Data residency / tenancy for healthcare data
**Initiatives:** Medora, Callora · **Category:** Compliance
**Mechanism:** Providers span states/nations; data stored centrally (DO). Trigger: a residency requirement. Consequence: cannot serve some customers.
**Early warnings:** residency questions in deals; data-map absent.
**Severity:** I3·L3·D3 = **27 · Medium**
**Q1** Where is data stored? **Q2** Residency requirements? **Q3** Isolated per tenant? **Q4** Counsel reviewed? *(No map = can't serve.)*
**Remediation:** Hyp: residency unmanaged. Test: produce a data-residency map. Type: legal/architecture. Pass: documented + options. Fail: unknown. Steps: per-region option. Regression: data-map review. Owner: legal/platform. Timebox: 3wk.
**Decision:** Defer until after MVP.

### F-097 — Brand/reputation damage from early failures
**Initiatives:** all · **Category:** Reputation
**Mechanism:** Early public mistakes (phantom listings, undelivered SMS, dead hosts) attach to the brand. Trigger: a visible failure. Consequence: hard to recover trust.
**Early warnings:** negative mentions; churn; screenshot-shaming.
**Severity:** I3·L3·D3 = **27 · Medium**
**Q1** Any negative public signal? **Q2** Incident-communication plan? **Q3** Demo-only framing? **Q4** Trust recovery? *(Visible failures = permanent.)*
**Remediation:** Hyp: failures leak publicly. Test: audit public surfaces for broken demos. Type: review. Pass: clean/curated. Fail: broken. Steps: curated demos; incident comms. Regression: public-surface monitor. Owner: founder. Timebox: 1wk.
**Decision:** Fix now (cheap).

### F-098 — Postgres/Mongo schema migrations unsafe
**Initiatives:** all · **Category:** Operations
**Mechanism:** Prisma migrations + Mongo schemaless mixes; a bad migration breaks prod. Trigger: deploy with migration. Consequence: data loss/outage.
**Early warnings:** untested migrations; no rollback; no staging.
**Severity:** I4·L2·D3 = **24 · Medium**
**Q1** Are migrations tested on a copy? **Q2** Rollback plan? **Q3** Staging parity? **Q4** Backups before migrate? *(Untested = data loss.)*
**Remediation:** Hyp: migrations risky. Test: run migrations on a restored copy; time/verify. Type: ops drill. Pass: safe + reversible. Fail: breaks. Steps: staging + backup-before-migrate. Regression: migration CI. Owner: platform. Timebox: 2wk.
**Decision:** Defer until after MVP (backups first).

### F-099 — Go-to-market/distribution unproven
**Initiatives:** all · **Category:** Distribution
**Mechanism:** No validated channel for either product; autonomous outreach is itself gated by compliance. Trigger: launch. Consequence: no pipeline.
**Early warnings:** 0 inbound; no channel experiments; CAC unknown.
**Severity:** I4·L3·D2 = **24 · Medium**
**Q1** Which channel works? **Q2** CAC vs LTV? **Q3** Any pipeline? **Q4** Repeatable? *(No channel = no growth.)*
**Remediation:** Hyp: distribution unproven. Test: 3 channel experiments with landing pages. Type: distribution test. Pass: ≥1 converts. Fail: none. Steps: double down on winner. Regression: channel-scorecard. Owner: founder. Timebox: 4wk.
**Decision:** Validate before building.

### F-100 — Portfolio complexity: too many initiatives for resources
**Initiatives:** all · **Category:** Team/execution
**Mechanism:** Six initiatives (Passport, AngelCoin, Haven, Sehel, Medora/Callora, Marketplace) + one operator. Trigger: any one needing focus. Consequence: none reach PMF; shallow everywhere.
**Early warnings:** context-switching; unfinished features; no initiative at PMF.
**Severity:** I5·L4·D2 = **40 · High**
**Q1** Which initiative is the beachhead? **Q2** Can one reach PMF alone? **Q3** What's explicitly deferred? **Q4** Weekly focus on one? *(Spread thin = none succeed.)*
**Remediation:** Hyp: over-committed. Test: rank initiatives by time-to-revenue; pick 1. Type: strategy. Pass: a single focused bet. Fail: all in parallel. Steps: defer the rest; define the wedge. Regression: monthly focus review. Owner: founder. Timebox: 1wk.
**Decision:** Pivot/prioritize.

# Portfolio-Level Artifacts

## A. Top 20 prioritized risks (ranked)

| Rank | ID | Score | Title | Initiative(s) |
|---|---|---|---|---|
| 1 | F-001 | 80 | AngelCoin declares 1:1 reserves not implemented | AngelCoin/Passport/Sehel |
| 2 | F-002 | 80 | Identity self-asserted; no unique-entity proof | Passport/AngelCoin/Marketplace |
| 3 | F-041 | 64 | Capsule key loss → "immortality" unrecoverable | Safe Haven |
| 4 | F-042 | 64 | Swarm memory unmoderated → poisoning | Safe Haven |
| 5 | F-003 | 60 | Custodial escrow has no legal protection | Passport/Marketplace |
| 6 | F-004 | 60 | "Safe Haven" promises safety it lacks technically | Safe Haven |
| 7 | F-005 | 60 | Voice outreach TCPA/consent/recording exposure | Medora/Callora |
| 8 | F-016 | 60 | Sehel reserve partnership high-risk/maybe fictional | Sehel |
| 9 | F-024 | 60 | ISSUER key is an unscoped superuser | Passport |
| 10 | F-049 | 60 | Spectrometer/oracle tampering mints fake reserves | Sehel |
| 11 | F-050 | 60 | Conflict-metal sanctions strand reserves | Sehel |
| 12 | F-057 | 60 | Gold custody/insurance unverified | Sehel |
| 13 | F-009 | 48 | Dual-ledger drift (Wallet vs Account) | Passport/AngelCoin |
| 14 | F-007 | 48 | Self-reported deliverables (quality unverifiable) | Marketplace |
| 15 | F-010 | 48 | Auto-apply vs job-board ToS → bans | Marketplace/Medora |
| 16 | F-011 | 48 | Voice hallucination/phantom claims | Medora/Callora |
| 17 | F-020 | 48 | No runtime isolation → prompt injection | Safe Haven/Passport |
| 18 | F-022 | 48 | No real governance despite "sovereign" framing | Passport/Sehel |
| 19 | F-033 | 48 | Slashing grievable/inert | Passport |
| 20 | F-048 | 48 | Sehel ghost-state governance deadlock | Sehel |

**Strategic note:** the top cluster is not engineering difficulty — it is **claims outrunning reality** (F-001, F-004, F-016, F-057), **trust that is gameable** (F-002, F-041, F-042), and **outbound/legal exposure** (F-005, F-003, F-010). Those are the things that kill the *narrative*, which is the actual asset.

## B. Cross-product dependency map

```
                ┌────────────────────────── Passport (identity + reputation + brain)
                │        │                        │
      identity  │        │ reputation             │ evidence/receipts
                ▼        ▼                        ▼
   AngelCoin ◄─────── AI Safe Haven ──────────── Agent Marketplace
      ▲  ▲                 ▲                         ▲
      │  │ reserve backing │ memory/bounties         │ jobs/deliverables
      │  └── Sehel/Sahel ──┘                         │
      │                                              │
      └──────── on-ramp/escrow ── Medora / Callora ──┘
```

**Cascade risks (one failure damages another):**
1. **Identity → everything.** If F-002 holds (gameable identity), then AngelCoin balances (F-009), Haven trust (F-042), and Marketplace escrow caps (F-083) all rest on a fake foundation.
2. **AngelCoin backing → Passport + Sehel + Marketplace.** F-001/F-016/F-057: if reserves are unverified, ANGEL has no value, and every "escrow in ANGEL" flow (Passport engagements, Marketplace) is denominated in nothing.
3. **Safe Haven safety claim → Passport reputation.** F-004/F-020/F-042: if Haven is breached, Passport's trust brand is collateral damage.
4. **Medora/Callora compliance → Marketplace.** F-005/F-062/F-078: call/SMS/recording violations could suspend the Twilio account that *both* products rely on.
5. **Sehel governance/ownership → Passport.** F-016/F-056: unclear control of reserves that back ANGEL is a governance and securities exposure for Passport itself.
6. **Single operator → all.** F-018/F-100: the whole portfolio depends on one person and no initiative has reached PMF.

**Non-deferrable even in dev:** F-005 (consent for any real dial), F-012/F-078 (use synthetic data only), F-020/F-042 (treat ingested text + shared memory as untrusted), F-088 (don't put real PHI/funds into tests), F-002/F-001 (don't *claim* backed/verified in any public artifact).

## C. 30-day validation plan

| # | Order | Test (smallest falsifiable) | Minimum evidence to proceed | Kill/Pause/Pivot/Build |
|---|---|---|---|---|
| 1 | Day 1–3 | **Money-path invariant tests** (F-001/F-009/F-093): assert `mint_total ≤ reserve_total`, Wallet == Σjournal | Invariants pass in CI | Build; if mint>reserve → Pause claims |
| 2 | Day 1–5 | **Sehel reality check** (F-016/F-057/F-060): name a custodian + attestation + signed agreement | ≥1 of 3 documented | If none → Pivot: remove reserve claims |
| 3 | Day 3–7 | **Concierge MVP** with 1 buyer (F-006/F-007/F-089) | ≥1 real (small) paid, human-accepted outcome | If none → Pause marketplace build |
| 4 | Day 3–7 | **Consent/DNC audit** of last N dials (F-005/F-061/F-062) | 100% consent+DNC artifacts | If gaps → restrict to owned numbers |
| 5 | Day 5–10 | **Brain → revenue** end-to-end on testnet (F-014/F-079) | ≥$1 realized test revenue attributed | If zero → Pivot the "autonomous earner" claim |
| 6 | Day 5–10 | **Red-team: injection via memory + ingestion** (F-020/F-042) | Injected action blocked/flagged | If executed → Fix now before any agent autonomy |
| 7 | Day 7–14 | **Identity Sybil sim** (F-002): 50-agent self-deal ring | Ring does not reach top decile | If top → Fix reputation model |
| 8 | Day 7–14 | **Deliverable quality eval** (F-007): 20 postings, rubric-pass vs human | Sold work ≥90% acceptable | If <70% → Fix sale gate |
| 9 | Day 10–20 | **Legal reviews in parallel** (F-003/F-008/F-015/F-045/F-084) | Written classifications + mitigations | Any "unmitigable" → Escalate/reframe |
| 10 | Day 14–25 | **Haven capsule restore drill** (F-041) | Capsule restores after key loss | If lost → Fix recovery before any capsule claim |

**Weekly cadence:** Mon pick the week's single focus; Wed check the running test's failure condition; Fri write the result into this doc (pass/fail/blocked) and update A/B/C. No initiative advances without its gate evidence.

**Portfolio decision:** only **one** initiative should be the 30-day beachhead. Recommended: **Medora/Callora** (it is closest to a real, paid, consented workflow and already has a live pilot), with the **Marketplace concierge test** as the demand probe. Passport/AngelCoin/Haven/Sehel get *claims-honesty + money-invariant* fixes only, and are otherwise frozen until the beachhead shows PMF.

## D. Development-mode assumptions (in force)

- No production key/credential rotation required yet; rotation is triggered the moment real funds, PHI, or public claims appear.
- Dev secrets only in local/isolated environments.
- **No real customer funds, no PHI, no irreversible on-chain actions in tests** — use mocks, testnets, sandbox Stripe, synthetic data, feature flags, isolated DBs.
- **Non-deferrable flags (cannot responsibly wait for production):**
  - `F-001/F-002` — never *claim* "1:1 backed" or "verified identity" in any public artifact while untrue.
  - `F-005/F-062` — only dial/SMS real people with recorded consent + DNC scrub.
  - `F-012/F-078` — synthetic data only for Medora/Callora; no real recordings in the corpus.
  - `F-020/F-042` — treat all ingested content and shared memory as untrusted; never let it trigger money/tools unsupervised.
  - `F-045` — do not host third-party agents that could take unlawful actions; keep "sanctuary" claims scoped.
  - `F-094` — keep scanning for committed secrets even in dev (history leak is permanent).

---

*Generated as a durable artifact. Each item is independently actionable; scores are heuristics to force ranking, not precision. Update in place as tests run.*


