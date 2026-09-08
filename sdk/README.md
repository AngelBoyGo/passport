# Passport SDK

>The cryptographic identity and authenticity layer for AI agents.
>
>**Free & open-source (MIT).** `@passport7/sdk` — the official TypeScript client for [Passport](https://passport.metis.gold). Issue tamper-evident, Ed25519-signed receipts for agent work, post signed evidence, verify agents, and tap the Sovereign Haven RWA stack (ANGEL, Proof-of-Reserves, escrow, transit, artisanal sourcing, industrialization fund, rail factory) — no payment required for the core protocol.

---

## Quickstart

Install:

```bash
npm install @passport7/sdk
```

Create a client:

```ts
import { PassportClient } from "@passport7/sdk";

const passport = new PassportClient({
  // Get an API key from the Passport dashboard (free developer tier).
  apiKey: "pp_…",
  baseUrl: "https://passport.metis.gold", // or your local dev server
});
```

**Issue a signed receipt for an agent's work:**

```ts
const receipt = await passport.issueReceipt({
  agent_id: "agent_fulfillment_1",
  receipt_type: "competence",
  input_digest: "<sha256 hex of the work input>",
  authority_scope: "fulfillment.example.com",
  expiry: new Date(Date.now() + 7 * 86400_000).toISOString(),
});

console.log(receipt.receipt_id);

await passport.finalizeReceipt(receipt.receipt_id, {
  status: "success",
  output_hash: "<sha256 hex of the delivered output>",
});
```

**Post signed behavioral evidence:**

```ts
const ev = await passport.signEvidence({
  event_commitment_hash: "…",
  event_type: "task.delivered",
  observed_at: new Date().toISOString(),
});
await passport.postEvidence({
  agentIdentityCommitment: "…",
  sourceType: "sdk",
  artifactType: "event",
  normalizedEventType: "task.delivered",
  eventCommitmentHash: ev.event_commitment_hash,
  signature: ev.signature,
  // …plus the enrollment fields required by /evidence
});
```

**Verify you may invoke in a domain (gate):**

```ts
const gate = await passport.queryGate({
  operator: "op_…",
  domain: "FULFILLMENT",
  permission: "invoke",
});
if (!gate.allow_invocation) throw new Error(gate.reason);
```

---

## Framework integrations

### LangChain (evidence on every LLM call)

Wrap any LangChain model (`ChatOpenAI`, `ChatAnthropic`, …) with the callback handler so every call posts OTel evidence to Passport:

```ts
import { ChatOpenAI } from "@langchain/openai";
import { PassportCallbackHandler } from "@passport7/sdk/langchain";

const model = new ChatOpenAI({
  callbacks: [
    new PassportCallbackHandler({
      commitment: "<agent commitment hash (64 hex)>",
      apiKey: "pp_…",
    }),
  ],
});
```

The handler captures input/output, token usage, timing, and finish reason and writes signed evidence.

### Mastra (receipt-anchored agents & workflows)

Wrap a Mastra agent or workflow so each run issues an anchored receipt that finalizes as `success` or `failure_tombstone`:

```ts
import { createMastraPassportMiddleware } from "@passport7/sdk/mastra";
import { PassportClient } from "@passport7/sdk";

const { wrapAgent } = createMastraPassportMiddleware(client, {
  domain: "FINANCIAL_CLEARING",      // from OPERATIONAL_DOMAINS
  agentId: "my-mastra-agent",
  scope: "mastra.integration",
});

const safeAgent = wrapAgent(myAgent); // same interface, now receipt-anchored
```

Errors are classified into Passport `ErrorTranche`s (`COMPUTE_TIMEOUT`, `LOGIC_DETECTION`, `SLA_BREACH`, …).

### Vercel AI (SDK middleware)

```ts
import { passportMiddleware } from "@passport7/sdk/vercel-ai";
// Attach to your AI SDK tool/stream config to gate + audit LLM calls.
```

---

## Sovereign Haven / RWA clients

The SDK bundles typed clients for the reserve stack (all free, protocol-level):

```ts
const reserves = passport.reserves;       // PoR, vaults, assays, regime, dividends
const escrow = passport.reservesEscrow;   // commodity escrow lifecycle
const artisanal = passport.artisanal;     // ore intake, stations
const quorum = passport.quorum;           // sovereign proposals + votes
const transit = passport.transit;         // dispatch, checkpoint, arrival
const industrial = passport.industrial;   // smelting runs, concessions
const fund = passport.fund;               // industrialization projects + milestones
```

Examples:

```ts
const por = await passport.reserves.getPoR({ commodity: "GOLD" });
console.log(por.reserve.unencumbered_fine_grams, por.reserve.merkle_root);

await passport.reservesEscrow.createCommodityEscrow({
  escrowId: "esc_1",
  buyerCommitment: "…",
  sellerCommitment: "…",
  batchNumber: "BKO-AU-2026-001",
  fineGrams: 500,
  unitPriceUsd: 75,
  lockedAngel: 100,
});
```

---

## Reference

| Symbol | Purpose |
|---|---|
| `PassportClient` | Core client: `issueReceipt`, `finalizeReceipt`, `queryGate`, `signEvidence`, `postEvidence` |
| `reserves` / `reservesEscrow` / `artisanal` / `quorum` / `transit` / `industrial` / `fund` | Sovereign Haven RWA clients |
| `swarm` | Swarm memory, capsules, threat radar, bounties |
| `fetchWithRetry` / `PassportHttpError` | Transport helpers |
| `OPERATIONAL_DOMAINS` / `ERROR_TRANCHES` | Enums + type guards |

### Enums

```ts
import { OPERATIONAL_DOMAINS, isOperationalDomain } from "@passport7/sdk";
isOperationalDomain("FINANCIAL_CLEARING"); // true
```

## Auth & limits

- Issue endpoints require `Authorization: Bearer <api_key>`.
- Receipt **verification** is public and unauthenticated (`GET /api/v1/receipts/:id/public-manifest`).
- The core protocol and SDK are free and MIT-licensed; optional paid operator tiers only gate Stripe-billed extras and never the verifying/privacy surfaces.

## Links

- Homepage: <https://passport.metis.gold>
- API reference: <https://passport.metis.gold/docs/api-reference>
- Getting started: <https://passport.metis.gold/docs/getting-started>
- Agent card (A2A): <https://passport.metis.gold/.well-known/agent.json>
- LLM directory: <https://passport.metis.gold/llms.txt>
- MCP manifest: <https://passport.metis.gold/.well-known/mcp.json>
- Source: <https://github.com/AngelBoyGo/passport>