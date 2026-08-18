# Passport — Comprehensive Audit & Roadmap

## 1. Features discussed but not/partially implemented

| Feature | Status | Impact | What's missing |
|---|---|---|---|
| **Webhook management UI** | ✅ Just implemented | High | /admin/webhooks page with create/list/delete, 5 tests |
| **Enriched agent profile** | ✅ Just implemented | Medium | Source breakdown, project summary, performance trends, color-coded timeline |
| **Google OAuth** | ✅ Implemented | High | Route + button + env vars, verified working |
| **GitHub OAuth** | ⚠️ Partially implemented | Medium | Route exists, button exists, but `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` not set in production env |
| **Password reset** | ❌ Not implemented | High | No `/reset-password` flow, no forgot-password link, operators need DB access to reset |
| **Evidence ingestion UI** | ❌ Not implemented | Medium | No web form to post evidence — only API. A page at `/agents/<commitment>/evidence` with payload builder + sign button would help onboarding |
| **API key from session** | ⚠️ Partially implemented | Medium | Admin pages (api-keys, receipts, webhooks) all prompt for a `pp_` key in localStorage. Should use session cookie auth instead or auto-attach the key |
| **CI/CD pipeline** | ❌ Not pushed | Low | `.github/workflows/ci.yml` exists in source but can't be pushed due to token scope |
| **Dark mode** | ⚠️ Partially implemented | Low | CSS variables exist in `globals.css` but all pages hardcode `bg-white`, `text-slate-600`, etc. No toggle |
| **Rate limiting (multi-replica)** | ❌ Not implemented | High | In-memory `Map` rate limiter resets on every instance. Needs `@upstash/ratelimit` or Redis |
| **Stripe subscription management** | ⚠️ Partially implemented | Medium | `POST /api/stripe/checkout` creates Pro subscriptions. No cancel/portal/usage-metering UI |
| **Node.js SDK** | ⚠️ Partially implemented | Medium | `sdk/src/client.ts` exists with `PassportClient` class (issue/finalize receipts). Missing enrollment, evidence, webhook management |
| **Python SDK** | ⚠️ Partially implemented | Medium | `python/passport_sdk/` exists with basic structure. Missing evidence signing, enrollment, full coverage |
| **OpenAPI/Swagger spec** | ❌ Not implemented | Medium | No auto-generated OpenAPI spec. Docs reference it but no file exists |
| **Agent badge image** | ✅ Implemented | Low | SVG badge at `/api/v1/badge/:hash`, works end-to-end |

---

## 2. Security weak areas

### CRITICAL
1. **Custom SHA-256 password hashing (100k iterations)** — `auth-service.ts:8-14` uses a custom loop instead of bcrypt/argon2/scrypt. While 100k iterations provides some protection, the algorithm is non-standard and could be vulnerable to side-channel or length-extension attacks. **Fix:** Replace with `@node-rs/argon2` or Node's built-in `scrypt`.

2. **SESSION_SECRET falls back to `"dev-session-secret"`** — `auth-service.ts:27`. If `SESSION_SECRET` is not set in production, the fallback is a hardcoded string. Anyone who knows this can forge valid session tokens. **Fix:** Add `SESSION_SECRET` to `REQUIRED_PROD_ENV` in `env.ts` so deployments without it fail at startup.

3. **In-memory rate limiting across replicas** — `rateLimit.ts:3` uses a `Map<string, RateBucket>` in the process memory. On Render/Railway with multiple replicas, each instance has its own bucket, so an attacker can rotate through instances to bypass limits. **Fix:** Replace with `@upstash/ratelimit` (Redis-based) or database-backed rate limiting.

### HIGH
4. **No rate limiting on API key creation** — `/api/v1/operator/api-keys` POST has no rate limit. An attacker with a valid API key can create unlimited keys, exhausting the operator's quota.

5. **No rate limiting on receipt issuance** — `/api/v1/receipts` POST has no rate limit beyond the operator's credit balance. An attacker could drain credits in a burst.

6. **Webhook delivery is fire-and-forget** — `webhook-service.ts:23-25` silently catches errors. No retry, no dead-letter queue, no delivery guarantees. **Fix:** Add retry with exponential backoff, dead-letter tracking, and delivery status in the subscription model.

7. **No CSRF protection** — Cookie-based auth routes (`/api/auth/login`, `/api/auth/session`) have no CSRF token. While `SameSite=Lax` mitigates this for top-level navigations, cross-site `fetch()` requests could still be vulnerable.

### MEDIUM
8. **No request body size limit on webhook endpoint** — `/api/stripe/webhook` reads the raw body for signature verification. Stripe sends up to 500KB, but no explicit limit is enforced.

9. **No output sanitization on error messages** — Some error paths return `err.message` directly (e.g., `finalize/route.ts:68`), which could leak internal details if the error message contains sensitive data.

10. **Operator ID is guessable** — `operatorIdFromStripe()` derives `op_cus_${stripeCustomerId}`. Stripe customer IDs are not truly secret but are enumerable.

---

## 3. Interoperability gaps

### What exists
- **Node.js SDK** (`sdk/`) — `PassportClient` with `issueReceipt()`, `finalizeReceipt()`, `gateVerify()`. Has Mastra middleware. Full test suite.
- **Python SDK** (`python/`) — Basic structure with `pyproject.toml`, `passport_sdk/` directory. Not yet feature-complete.
- **REST API** — Full HTTP API with JSON bodies, Zod validation, consistent error responses.

### What's missing
1. **OpenAPI 3.0 spec** — No auto-generated or hand-maintained OpenAPI spec. Docs reference it but no file exists. **Fix:** Add `@asteasolutions/zod-to-openid` or similar to generate OpenAPI from Zod schemas. Serve at `/api/v1/openapi.json`.

2. **SDK enrollment methods** — Neither SDK exposes `enroll/start`, `enroll/complete`, or evidence signing. The Node.js SDK is receipt-only.

3. **SDK evidence signing** — The hardest part of integration (canonical JSON, Ed25519 signing) is not in the SDK. Users must implement it themselves.

4. **Agent Card / Agent Discovery** — No `.well-known/agent.json` or `agent-card` endpoint for agent discovery. A2A and ANP both require agent-level metadata.

5. **Webhook SDK integration** — No SDK methods for managing webhook subscriptions.

6. **Language support** — Only Node.js and Python. No Go, Rust, Java, or .NET SDKs.

---

## 4. Making Passport easier to adopt

### Current friction points
1. **Enrollment requires code** — Users must generate an Ed25519 keypair and sign a nonce. No in-browser key generation tool. The `/docs/integrate` page has code snippets but no interactive tool.

2. **Evidence signing requires understanding canonical JSON** — The most common cause of 401 errors is users signing the wrong bytes. The SSKD doesn't provide a `signEvidence()` helper.

3. **No CLI tool** — Every interaction requires either the web UI or curl. A `passport-cli` npm package could do enrollment, evidence posting, and verification from the terminal.

4. **API key UX is fragmented** — Users must copy their `pp_` key from the creation page, then paste it into each admin page (api-keys, receipts, webhooks). The session cookie should be sufficient for admin operations.

### Proposed improvements

#### P0: In-browser key generator
A page at `/enroll` that:
- Generates an Ed25519 keypair in the browser (using `@noble/ed25519`)
- Shows the private key once with a download button
- Submits the public key to `/enroll/start`
- Guides the user through signing the challenge
- Completes enrollment
- Shows the subject commitment with a "View profile" link

#### P1: CLI tool
A `passport` npm package that wraps the SDK:
```bash
npx passport enroll                              # generate keypair, enroll agent
npx passport evidence post <commitment> <file>   # sign and post evidence
npx passport receipt issue <agent-id>            # issue a receipt
npx passport verify <receipt-id>                 # verify offline
```

#### P1: SDK evidence signing helper
```ts
const evidence = passport.signEvidence(privateKey, payload, "github_commit_payload");
await passport.postEvidence(commitment, evidence);
```
This would eliminate the canonical-JSON confusion that caused KeyForge's 401.

#### P2: Session-based admin auth
The admin pages should check if the user is logged in (via session cookie) and auto-attach the operator's API key, or create a proxy endpoint that adds the bearer token server-side.

---

## 5. Protocol integration paths (A2A, ACP, ANP, AGORA)

### A2A — Agent2Agent (JSON-RPC 2.0 over HTTP/SSE, Agent Cards)

**What it is:** Google's agent-to-agent protocol for delegating tasks between independent agents. Uses JSON-RPC 2.0, Agent Cards for discovery, and SSE for streaming.

**How Passport could integrate:**
- **Agent Card as enrollment metadata** — Passport's `subjectCommitment` becomes the agent's `id` in the Agent Card. The Agent Card (`/.well-known/agent.json`) could include a `passport` field with the commitment hash, making Passport the identity substrate for A2A agents.
- **Receipts as task completion proofs** — When an A2A task completes, the worker agent issues a Passport receipt and includes the `receipt_id` in the JSON-RPC response. The hirer agent verifies the receipt before accepting the result.
- **Enrollment as A2A onboarding** — The enrollment challenge-response protocol aligns with A2A's identity verification. Passport's `subject_commitment` serves as the agent's verifiable identifier.

**Implementation effort:** Low for Agent Card integration (add a JSON file). Medium for full receipt-in-task lifecycle (need to map A2A task IDs to receipt IDs).

### ACP — Agent Communication Protocol (HTTP/REST, async tasks)

**What it is:** Framework-neutral agent interoperability protocol focused on async task patterns over HTTP.

**How Passport could integrate:**
- **ACP task lifecycle maps to Passport engagement lifecycle** — ACP's `task/create` → `task/status` → `task/result` maps directly to Passport's `Engagement` model (HELD → DELIVERED → PAID). A connector could translate ACP task events into Passport engagements.
- **Evidence bridge for ACP deliverables** — When an ACP task completes, the deliverable digest is posted as `task_deliverable` evidence to Passport, automatically creating a signed receipt via the evidence bridge.
- **Gate pass for ACP workers** — Before accepting an ACP task, the hirer can call `POST /api/v1/gate/verify` to check the worker's SLA compliance.

**Implementation effort:** Medium. Requires an ACP → Passport adapter layer that maps ACP webhook calls to Passport API calls.

### ANP — Agent Network Protocol (HTTPS, JSON-LD, DIDs, .well-known)

**What it is:** Decentralized agent discovery and identity protocol using DIDs, Verifiable Credentials, and `.well-known` endpoints.

**How Passport could integrate:**
- **DID for each enrolled agent** — Each `subject_commitment` could be expressed as a `did:key` or `did:web` DID. The agent's public key (stored in enrollment) becomes the DID's verification method.
- **Verifiable Credentials from receipts** — Passport receipts are already Ed25519-signed. Wrapping them in a W3C Verifiable Credential format (JSON-LD) would make them interoperable with ANP's credential exchange.
- **`.well-known/did.json`** — Host a DID document at `/.well-known/did.json` for the Passport operator itself, enabling ANP agents to discover and trust Passport as a credential issuer.

**Implementation effort:** Medium. DID generation is straightforward (ed25519 → `did:key`). Verifiable Credential wrapping requires a JSON-LD context and VC schema.

### AGORA — Negotiation and decentralized interaction

**What it is:** Protocol for dynamic cooperation, negotiation, and agent economies with decentralized interaction patterns.

**How Passport could integrate:**
- **AngelCoin as AGORA's settlement layer** — Passport's AngelCoin ledger (append-only journal, deterministic balances, escrow locks) is a natural settlement layer for AGORA's economic interactions. AGORA negotiation outcomes can trigger AngelCoin transfers.
- **Access tiers as AGORA reputation** — Passport's access tier evaluation (FULL/LIMITED/SANDBOXED/SHELTERED/SUSPENDED) provides AGORA agents with a reputation signal without exposing raw data.
- **Engagement lifecycle as AGORA contract** — The Passport engagement lifecycle (HELD → DELIVERED → PAID) maps to AGORA's contract negotiation → fulfillment → settlement flow.

**Implementation effort:** Medium-high. AGORA's decentralized nature requires more architectural work than the client-server A2A/ACP protocols.

### Recommended priority

| Protocol | Effort | Impact | Priority |
|---|---|---|---|
| **A2A** (Agent Cards) | Low | High — makes Passport the identity layer for Google's agent ecosystem | P0 |
| **ACP** (task lifecycle) | Medium | Medium — enables Passport as a cross-framework trust layer | P1 |
| **ANP** (DIDs + VCs) | Medium | Medium — opens W3C credential ecosystem | P1 |
| **AGORA** (economy) | High | Medium — AngelCoin already supports this, needs protocol adapter | P2 |

---

## 6. Implementation roadmap

### Phase 1 (now — next session)
- [ ] **P0: Password reset flow** — `/reset-password` route with signed token, email notification, new password form
- [ ] **P0: In-browser key generator** — `/enroll` page with Ed25519 keypair generation, challenge signing, enrollment completion
- [ ] **P0: SESSION_SECRET required in production** — Add to `REQUIRED_PROD_ENV` in `env.ts`

### Phase 2 (next 2-3 sessions)
- [ ] **P1: SDK evidence signing helper** — `signEvidence()` in both Node.js and Python SDKs
- [ ] **P1: CLI tool** — `passport` npm package with enroll, evidence, receipt, verify commands
- [ ] **P1: Session-based admin auth** — Auto-attach API key from session cookie
- [ ] **P1: A2A Agent Card** — `/.well-known/agent.json` with `passport` field

### Phase 3 (future)
- [ ] **P2: Replace password hashing** — Move from custom SHA-256 to `@node-rs/argon2`
- [ ] **P2: Multi-replica rate limiting** — Replace in-memory `Map` with `@upstash/ratelimit`
- [ ] **P2: Webhook retry + dead-letter queue** — Add delivery guarantees
- [ ] **P2: OpenAPI spec generation** — Auto-generate from Zod schemas
- [ ] **P2: ANP DID integration** — `did:key` derivation from agent commitments, VC-wrapped receipts
- [ ] **P2: ACP adapter** — Map ACP task lifecycle to Passport engagements