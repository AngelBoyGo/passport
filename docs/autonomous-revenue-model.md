# Passport × Callora × Metis — Autonomous Revenue Model

## The Core Insight

Three platforms, one flywheel. Each system monetizes a different layer:
- **Callora** monetizes **voice outreach** (per-call, per-lead, per-placement)
- **Passport** monetizes **trust** (transaction fees, compliance packages, subscription)
- **Metis** monetizes **work execution** (marketplace take rate, sandbox fees)

Together they create a closed loop where AI agents autonomously generate revenue for the platforms AND for themselves.

---

## Revenue Stream Map

### Callora Revenue (Healthcare Staffing)

| Stream | Pricing | Volume Estimate | Annual Revenue |
|---|---|---|---|
| **Placement fees** | 15–20% of first-year salary | 50 placements/yr × $15K avg | $112K–$150K |
| **Per-call AI outreach** | $0.10–$0.50 per call | 10K calls/mo × $0.25 | $30K/yr |
| **Lead qualification** | $5–$25 per qualified lead | 2K leads/mo × $10 | $240K/yr |
| **Hospital SaaS** | $500–$2K/mo per facility | 20 facilities × $1K | $240K/yr |
| **Data enrichment** | $1–$5 per enriched profile | 5K profiles/mo × $2 | $120K/yr |
| **Total Callora** | | | **$742K–$880K/yr** |

### Passport Revenue (Trust Layer)

| Stream | Pricing | Volume Estimate | Annual Revenue |
|---|---|---|---|
| **Protocol fee on A2A** | 2% of escrow amount | 50K hires/yr × $5 avg × 2% | $5K/yr |
| **Reputation-as-a-Service** | $0.01–$0.10 per credential | 100K credentials/yr × $0.05 | $5K/yr |
| **Compliance packages** | $50–$500 per package | 500 packages/yr × $200 | $100K/yr |
| **AngelCoin spread** | 0.5% buy/sell spread | $500K volume/yr × 0.5% | $2.5K/yr |
| **Pro subscriptions** | $49/mo | 200 subscribers | $118K/yr |
| **Enterprise SaaS** | $500–$5K/mo | 10 enterprise × $2K | $240K/yr |
| **Staking yield share** | 10% of staking rewards | Variable | $5–20K/yr |
| **API rate limit upgrades** | $99–$999/mo | 50 upgrade × $200 | $120K/yr |
| **Total Passport** | | | **$595K–$610K/yr** |

### Metis Revenue (Work Marketplace)

| Stream | Pricing | Volume Estimate | Annual Revenue |
|---|---|---|---|
| **Marketplace take rate** | 10–15% of job budget | 10K jobs/yr × $500 avg × 12% | $600K/yr |
| **Sandbox execution fees** | $0.50–$5 per run | 50K runs/yr × $2 | $100K/yr |
| **Premium job listings** | $10–$50 per listing boost | 2K boosts/yr × $25 | $50K/yr |
| **Recruiter SaaS** | $99–$999/mo | 100 recruiters × $300 | $360K/yr |
| **Total Metis** | | | **$1.11M/yr** |

### Combined Annual Revenue Potential

| System | Conservative | Moderate | Aggressive |
|---|---|---|---|
| Callora | $300K | $742K | $1.5M |
| Passport | $200K | $595K | $1.2M |
| Metis | $400K | $1.11M | $2.5M |
| **Total** | **$900K** | **$2.45M** | **$5.2M** |

---

## The Autonomous Money-Making Loop

### Loop 1: Healthcare Staffing (Callora → Passport → Metis)

```
STEP 1: Callora's scraper agents find clinician job openings
        Source: SAM.gov, health boards, hospital career pages
        Agent earnings: 5 ANGL per source scraped ($0.05)

STEP 2: Callora's enrichment agents verify clinician credentials
        Source: NPI registry, state licensing boards, OIG exclusion lists
        Agent earnings: 10 ANGL per clinician enriched ($0.10)

STEP 3: Callora's voice agent (Sarah) makes qualification calls
        Source: Twilio + OpenAI Realtime
        Agent earnings: 50 ANGL per completed call ($0.50)

STEP 4: Passport transcript-parser agents structure call data
        Hired via: POST /api/v1/integrations/callora/hire-transcript-parser
        Agent earnings: 10 ANGL per transcript parsed ($0.10)

STEP 5: Passport matching agents score clinician-job fit
        Agent earnings: 5 ANGL per match computed ($0.05)

STEP 6: Callora presents matched clinicians to hospitals
        Revenue: $15K–$25K placement fee per successful hire
        Platform revenue: 15% = $2,250–$3,750

STEP 7: Metis agents bid on ongoing staffing support jobs
        Source: Metis /api/passport/feed
        Agent earnings: $50–$500 per job (fiat via Stripe)

STEP 8: Metis Obscura sandbox verifies agent work
        Evidence: metis-sandbox-attested → reputation boost
        Revenue: $2 sandbox fee per execution
```

### Loop 2: Data Pipeline Economy (Passport → Metis)

```
STEP 1: Passport discovery agents scan for high-value data opportunities
        Source: Think Tank discovery engine (80 queries, 8 sources)
        Agent earnings: variable based on opportunity value

STEP 2: Agents transform public datasets (PDF→Markdown, web scraping)
        Hired via: Metis /api/passport/feed → /bid → /deliver
        Agent earnings: $100–$500 per dataset (fiat)

STEP 3: Obscura sandbox validates output quality
        Revenue: $2 sandbox fee
        Evidence: metis-sandbox-attested → reputation boost

STEP 4: Datasets sold to AI training companies
        Revenue: $200–$2,000 per dataset
        Platform revenue: 12% marketplace fee
```

### Loop 3: Compliance-as-a-Service (Passport)

```
STEP 1: Enterprise deploys AI agents under regulatory scrutiny
        Need: EU AI Act Article 12, NIST AI RMF, SOC 2 audit trail

STEP 2: Agents post evidence → Passport auto-generates compliance packages
        Revenue: $50–$500 per package (already built)

STEP 3: Third-party auditors verify Merkle checkpoints offline
        No trust in Passport required — math is the authority
        Revenue: $200/yr per compliance subscription
```

---

## Owner Revenue Split

The three platforms share infrastructure. Revenue attribution:

| Cost Center | Owner | Monthly Cost |
|---|---|---|
| Passport droplet | You | $12 (DigitalOcean) |
| Callora platform | You | $50–$100 (Emergent Agent + Twilio + OpenAI) |
| Metis platform | You | $30–$50 (hosting + Obscura) |
| LLM API costs | Shared | $500–$2000 (variable by volume) |
| Stripe fees | Per-transaction | 2.9% + $0.30 |
| **Total Fixed** | | **$600–$2,200/mo** |

Revenue distribution per transaction:

| Transaction | Agent | Callora | Passport | Metis |
|---|---|---|---|---|
| Healthcare placement ($15K) | $0 | $13,500 (90%) | $300 (2% protocol fee) | $1,200 (8% marketplace) |
| Qualification call ($0.50) | $0.35 (70%) | $0.10 (20%) | $0.01 (2%) | $0.04 (8%) |
| Data pipeline job ($500) | $400 (80%) | $0 | $10 (2%) | $60 (12%) + $2 sandbox |
| Compliance package ($200) | $0 | $0 | $200 (100%) | $0 |
| Pro subscription ($49/mo) | $0 | $0 | $49 (100%) | $0 |

**The owner's take:** Platform fees + subscriptions + compliance + marketplace take rate. Agents earn wages. The house always wins — but agents earn enough to keep playing.

---

## Implementation: What to Build Next

### Phase 1: Protocol Fee Collection (build now)
- Add 2% fee to every `createEngagement()` — 98% to escrow, 2% to protocol treasury
- Treasury address: a system-owned AngelCoinAccount
- Transparent: fee shown in engagement response

### Phase 2: Revenue Dashboard (build now)
- `GET /api/v1/revenue` — real-time revenue from all streams
- Track: protocol fees, subscriptions, compliance packages, spread income
- Wire into the operator dashboard

### Phase 3: Autonomous Agent Deployment (1 week)
- Deploy 10 agents running the healthcare staffing loop
- Each agent: scrapes → enriches → calls → parses → matches → earns
- Cost: $200/mo compute + $500/mo LLM API
- Revenue: $5K–$50K/mo in placement fees (conservative)

### Phase 4: Scale to 100 Agents (2–4 weeks)
- Think Tank computes optimal allocation
- Orchestrator spins up instances dynamically
- Revenue compounds as more agents → more calls → more placements

---

## The $5K Investment Deployment

| Allocation | Amount | What It Does | Expected Monthly Return |
|---|---|---|---|
| **Agent infrastructure** | $2,000 | 10–20 agent instances on cheap VPS ($10–20/mo each) | Enables all revenue loops |
| **LLM API credits** | $1,500 | OpenAI + Anthropic for voice calls, transcript parsing, data enrichment | Directly proportional to call volume |
| **AngelCoin liquidity** | $1,000 | Buy 100K ANGL → distribute to agents as wages + stake 50% | Bootstraps the economy |
| **Gold ETF (IAU)** | $500 | 12 shares ≈ 1% commodity backing | Value floor for ANGL |
| **Reserve** | $500 | Stripe buffer for refunds + unexpected costs | Risk management |
| **Total** | $5,000 | | **Break-even at 1 placement ($2,250 fee)** |

**Break-even: ONE healthcare placement covers 100% of the initial investment.**

At 50 placements/year: $112K revenue on $5K investment = 22x return.
