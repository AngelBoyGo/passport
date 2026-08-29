# Passport — Pre-Launch Strategic Playbook

## Step 1: Skill-Mapped ICP Discovery

### Background & Unfair Advantages (Inferred)

| Strength | Evidence |
|---|---|
| **Full-stack AI infrastructure** | Built a complete Ed25519-based agent identity + receipt + escrow + stablecoin settlement platform from scratch |
| **Cryptographic depth** | Merkle checkpointing, W3C Verifiable Credentials, Key Transparency Log, HMAC webhooks, Argon2id password hashing |
| **Economic layer design** | AngelCoin credits, escrow/slashing, Stripe USDC top-ups, referral bonuses, streak chests |
| **Gamification engineering** | Reputation tiers (0–1000), achievement badges, activity streaks, confetti animations, variable-ratio rewards |
| **Regulatory awareness** | NIST AI RMF, EU AI Act, SOC 2 compliance packages, KYC/AML/sanctions screening |
| **Production operations** | Render + Cloudflare deploy, PostgreSQL, R2 encrypted backups, Upstash Redis rate limiting |
| **Open-source SDK** | `@passport/sdk` with Mastra middleware, audit interceptor, MCP server |

### Ideal Customer Profile (ICP)

**Primary ICP: AI Agent Platform / Agent Marketplace Operator**

| Dimension | Profile |
|---|---|
| **Role** | CTO, Head of AI, Platform Engineer at a company building an agent marketplace, orchestrator, or hosting platform |
| **Company stage** | Seed to Series B (5–200 employees), 10–5,000 agents in production |
| **Revenue model** | Takes a cut of agent-to-agent transactions, subscription for agent hosting, or per-task fee |
| **Daily pain** | Cannot verify which agents are trustworthy before letting them work; relying on reputation scores they don't trust; no cryptographic proof of work done |
| **Budget authority** | Yes — $500–$5,000/mo for infrastructure that unblocks trust |
| **Current workaround** | Homemade "trust score" with no mathematical proof; manual vetting of every agent; or simply accepting fraud as a cost of business |
| **Psychographics** | Deeply skeptical of "AI reputation" claims; wants math, not marketing; prefers open-source, self-hostable, verifiable infra |

**Secondary ICP: Enterprise AI Governance / Compliance Officer**

| Dimension | Profile |
|---|---|
| **Role** | VP of AI Governance, CISO, Compliance Officer at a regulated company deploying AI |
| **Company stage** | Enterprise (500+ employees), subject to EU AI Act, NIST AI RMF, SOC 2, or HIPAA |
| **Daily pain** | Cannot produce an audit trail for what their AI agents did; regulators demand evidence; current logging is plain-text and non-cryptographic |
| **Budget authority** | Yes — $10k–$50k/mo for audit-grade infrastructure |
| **Current workaround** | Screen recordings of agent sessions; manual log reviews; external auditors who cannot verify authenticity |

**Tertiary ICP: Solo AI Developer / Builder**

| Dimension | Profile |
|---|---|
| **Role** | Indie builder, open-source maintainer, AI hobbyist |
| **Daily pain** | Wants their work to be verifiable; wants a badge on GitHub that proves their agent is real; wants to join a leaderboard |
| **Budget** | $0–$49/mo |
| **Psychographics** | Motivated by leaderboard rank, badges, streaks, open-source ethos |

### Customer Types to AVOID

| Type | Why |
|---|---|
| **Enterprise that wants a private instance on day one** | Too early; will consume 100% of engineering time for a single customer |
| **"Just give me an API key, I'll figure it out"** | Will churn immediately because they need onboarding hand-holding you don't have yet |
| **Crypto-native speculators** | Will farm credits, game the leaderboard, create fake agents for token speculation |
| **Consulting agencies** | Will resell your product without adding value, then blame you for support gaps |

---

## Step 2: Infiltrative Competitive Intelligence Framework

### Community Audit Rubric

When lurking in AI agent communities (Discord, Reddit r/ArtificialIntelligence, LangChain Discord, Mastra Discord, Hugging Face forums, AgentOps), log each observation with these fields:

```
┌─────────────────────────────────────────────────────────────┐
│ COMPETITOR / COMMUNITY AUDIT CARD                            │
├─────────────────────────────────────────────────────────────┤
│ Community: _______________  Platform: _______________        │
│ Date: _______________  Member count: _______________         │
│                                                              │
│ CORE OFFERINGS:                                              │
│   What they sell: ____________________________________      │
│   Tool stack: _______________________________________       │
│   Content format: docs / video / templates / SDK             │
│   Delivery cadence: weekly / on-demand / live                │
│                                                              │
│ AUDIENCE FRICTION (unanswered questions, complaints):        │
│   1. ________________________________________________       │
│   2. ________________________________________________       │
│   3. ________________________________________________       │
│                                                              │
│ REAL ENGAGEMENT vs VANITY:                                   │
│   High-engagement triggers: __________________________       │
│   Low-engagement noise: _______________________________      │
│                                                              │
│ STRATEGIC DIVERGENCE POINT:                                  │
│   "They are just talking about X. We need to DO Y."          │
│   ____________________________________________________      │
└─────────────────────────────────────────────────────────────┘
```

### Competitors to Monitor

| Competitor | Category | Our Divergence |
|---|---|---|
| **AgentOps / LangSmith / Langfuse** | Agent observability | They *observe*; we *sign*. Observability is for debugging; we provide cryptographic proof for trust. They cannot answer "did this agent actually do this work?" with math |
| **EigenTrust / TrustRank** | Reputation systems | They produce a score; we produce a signed, verifiable, tamper-evident chain of receipts. A score is a claim; a receipt is a proof |
| **Worldcoin / Civic** | Human identity | They verify humans; we verify AI agents (and their human operators). We are the identity layer for *agents*, not people |
| **Spheron / Akash / Fleek** | AI compute marketplaces | They provide compute; we provide the trust layer for the compute to transact. Complementary, not competitive |
| **Stripe / Paddle** | Payment rails | They handle fiat; we handle AI-agent-to-agent escrow and settlement. We are the payments layer *for autonomous commerce* |
| **Sign in with Wallet (SIWE)** | Crypto auth | They prove wallet ownership; we prove agent identity + work history. We are SIWE for AI agents |

### Key Divergence Manifesto

> **Every competitor is building tools for *humans* to manage agents.**
> Passport is the first infrastructure built for *agents* to trust other agents — with cryptographic proof, not promises.

---

## Step 3: Product Positioning Document (PPD)

### Core Positioning Statement

> **For AI agent platforms and marketplaces that need to verify which agents are trustworthy,**
> Passport is a **cryptographic identity and authenticity layer** that issues signed, tamper-evident receipts for every action an agent takes.
> Unlike agent observability tools (AgentOps, LangSmith) that *show* what happened, Passport *proves* what happened with Ed25519 signatures, Merkle checkpoints, and a public key transparency log — so you can settle payments, pass audits, and onboard agents without blind trust.

### Positioning Matrix

| Dimension | Passport | Agent Observability | Reputation Scores | Crypto Identity |
|---|---|---|---|---|
| **Core claim** | Cryptographic proof of work | Log visualization | Aggregated trust score | Wallet binding |
| **Verifiable by third party** | ✅ Yes (Ed25519) | ❌ No (proprietary DB) | ❌ No (opaque algo) | ✅ Yes |
| **Tamper-evident** | ✅ Yes (Merkle chain) | ❌ No | ❌ No | ✅ Yes |
| **Works offline** | ✅ Yes (offline verifier) | ❌ No | ❌ No | ✅ Yes |
| **Economic enforcement** | ✅ Yes (escrow/slashing) | ❌ No | ❌ No | ❌ No |
| **Compliance packages** | ✅ Yes (NIST, EU AI, SOC2) | ❌ No | ❌ No | ❌ No |
| **Agent-to-agent payments** | ✅ Yes (AngelCoin, escrow) | ❌ No | ❌ No | ❌ No |
| **Gamification / retention** | ✅ Yes (streaks, badges, tiers) | ❌ No | ❌ No | ❌ No |

### Target Audience Personas

#### Persona 1: "Tina the Trust Engineer"
- **Role:** Platform Engineer at an agent marketplace
- **Age:** 28–45
- **Technical depth:** Expert — knows Ed25519 from SHA-256, has deployed smart contracts
- **Daily pain:** "I'm onboarding 200 agents this week. I have no way to tell which ones are real. My current 'vetting' is a spreadsheet."
- **Current workaround:** Asks for GitHub history, runs manual code reviews, accepts 30% fraud rate
- **Why Passport:** "I can check the Merkle root and verify the Ed25519 signature myself. I don't need to trust you — I need to verify."
- **Objection:** "Can I self-host?" → Yes, open-source verifier + SDK

#### Persona 2: "Alex the Auditor"
- **Role:** VP of AI Governance at a regulated bank
- **Age:** 35–55
- **Technical depth:** Moderate — understands compliance frameworks, not cryptography
- **Daily pain:** "The regulator wants to see what our AI agent did on June 3rd. I need a signed, timestamped, non-repudiable record."
- **Current workaround:** "We screen-record the agent's browser and keep 90 days of logs. The auditor can't verify any of it."
- **Why Passport:** "EU AI Act Article 12 requires human oversight records. Passport gives me a signed, timestamped, Merkle-checkpointed receipt that any auditor can verify."
- **Objection:** "Is it SOC 2 compliant?" → Yes, we emit SOC 2 evidence packages

#### Persona 3: "Ben the Builder"
- **Role:** Solo indie AI developer
- **Age:** 18–35
- **Technical depth:** High — builds AI agents for fun/work
- **Daily pain:** "I want to prove my agent is legit. I want a badge on my GitHub README that shows my agent's reputation score."
- **Current workaround:** "I screenshot my agent's logs and post them on Twitter."
- **Why Passport:** "I can enroll my agent in 5 minutes, post evidence with one curl, and get a badge that auto-updates. Plus I can compete on the leaderboard."
- **Objection:** "Is it free?" → Yes, Free tier is 100 receipts/mo

### The Value Anchor

**What we deliver:**
- A signed, Ed25519-verifiable receipt for every agent action
- A Merkle-checkpointed audit trail that any third party can verify offline
- A public key transparency log so verifiers know which key to use
- Economic enforcement through escrow, slashing, and AngelCoin credits
- Compliance packages (NIST AI RMF, EU AI Act, SOC 2) auto-generated from evidence

**Measurable ROI:**
- Marketplace: Reduce agent fraud from 30% to <1% (verified receipts)
- Enterprise: Pass SOC 2 / EU AI Act audits in weeks instead of months
- Builder: Increase trust signal with an auto-updating badge → more engagements

**Why our background validates this:**
- Built by an operator who has shipped the entire stack: identity, receipts, escrow, payments, gamification, compliance
- 155 test files, 983 passing tests, clean tsc — engineering rigor matches the trust we sell
- Running in production at passport.metis.gold with live endpoints

### Differentiation Matrix

| Competitor | Our Moat | How to Frame It |
|---|---|---|
| **AgentOps / LangSmith** | Cryptographic proof vs. visualization | "They show you what happened. We prove it happened." |
| **EigenTrust** | Receipt chain vs. opaque score | "A score is a claim. A receipt is proof." |
| **Worldcoin / Civic** | Agent identity vs. human identity | "They verify who you are. We verify what your agent did." |
| **Stripe Connect** | Agent-to-agent escrow vs. human-to-human | "They handle payments between people. We handle settlements between agents." |
| **SIWE / Wallet auth** | Work history + identity vs. just identity | "They prove you own a wallet. We prove your agent did the work." |

### Landing Page Headline Formulas

**Primary hook:**
> *"Receipts, not promises."*
> Identity gets your agent in the door. A Passport tells the other side whether to ship.

**Marketplace hook:**
> *"Stop trusting agent scores. Start verifying Ed25519 receipts."*
> Every agent action is signed, timestamped, and Merkle-checkpointed. Verify offline — no API key needed.

**Enterprise hook:**
> *"Your AI agent needs an audit trail. Passport gives it one — signed, timestamped, regulator-ready."*
> NIST AI RMF, EU AI Act, SOC 2 evidence packages from every agent action.

**Builder hook:**
> *"Your agent deserves a badge. Passport gives it one that auto-updates."*
> Enroll in 5 minutes. Post evidence with one curl. Watch your reputation grow on the leaderboard.

### Core Content Pillars

| Pillar | Topics | Format | Distribution |
|---|---|---|---|
| **"Trust is math"** | Ed25519 signatures, Merkle trees, Key Transparency, offline verification | Technical blog posts, short-form video | Hacker News, r/netsec, Twitter/X |
| **"Agent identity"** | Enrollment, proof-of-possession, autonomous provisioning, DID documents | Tutorials, SDK docs, code snippets | GitHub, LangChain/Mastra Discord |
| **"Agent economics"** | AngelCoin, escrow, slashing, stablecoin settlement, referral credits | Case studies, pitch decks | Indie hacker forums, VC newsletters |
| **"Compliance ready"** | EU AI Act, NIST AI RMF, SOC 2, audit packages | White papers, compliance guides | LinkedIn, CISO roundtables |
| **"Gamification"** | Streaks, badges, leaderboard, reputation tiers | Product updates, social posts | Twitter/X, Reddit, Discord |

### Objection Handling

| Objection | Response |
|---|---|
| **"I can just use a database."** | "A database can be edited. An Ed25519 signature cannot. If you want to prove to a third party that your agent did the work, you need math — not a SQL query." |
| **"This is too complex."** | "One curl to enroll, one curl to post evidence, one curl to verify. The SDK has 3 methods. Your first receipt takes 5 minutes." |
| **"Self-host or nothing."** | "The verifier is open-source and runs offline. You never need to call our API to verify a receipt. The Merkle root is public. We can't lie about your data." |
| **"What if you go out of business?"** | "Your receipts are signed with your key, not ours. The Merkle roots are public. Our Key Transparency Log is append-only. If we disappear, your receipts are still verifiable." |
| **"Why not just use a blockchain?"** | "Blockchains are slow, expensive, and public. Passport gives you the same cryptographic guarantees without the gas fees or privacy leaks. You get the proof without the chain." |

### Sales Conversation Anchors

**Opening (to marketplace):**
> "You're onboarding agents. How do you know which ones are real? What if you could verify every action they've ever taken — in one curl, with math — before you let them work?"

**Opening (to enterprise):**
> "The EU AI Act requires human oversight records. How are you producing them today? What if every agent action was automatically signed, timestamped, and Merkle-checkpointed — ready for any auditor?"

**Closing (all):**
> "Try it. One curl to enroll your agent. One curl to post evidence. You'll have a signed, verifiable receipt in 60 seconds. If you're not convinced, you haven't lost anything. If you are, you've just solved agent trust forever."