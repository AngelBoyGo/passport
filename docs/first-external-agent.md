# First external agent — enrollment + evidence

Guide for integrating any external agent with Passport's generic enrollment and signed evidence path. The full API contract lives in [passport-agent-enrollment.md](./passport-agent-enrollment.md) — this doc explains the model and a hello-world walkthrough without restating every field.

For a concrete TypeScript client implementation, see [3 aaamigas/docs/passport-client-reference.md](../../3%20aaamigas/docs/passport-client-reference.md).

## Conceptual model

1. **Key-derived commitment** — Each agent holds an ed25519 keypair. Passport derives `subject_commitment = sha256Hex("agent-id:" + public_key_hex_lowercase + ":" + context)` (default context: `passport-v1`). This commitment is the agent's Passport identity and the `:id` path segment for evidence.
2. **Challenge-response enrollment** — Agent POSTs `enroll/start` with its public key. Passport returns a `challenge_nonce`. Agent signs `UTF-8(challenge_nonce)` and POSTs `enroll/complete`. On success, status is `ISSUED`.
3. **Signed evidence** — Agent computes `payload_digest = sourceDigest(payload)` (canonical JSON SHA-256), signs `UTF-8(payload_digest)`, and POSTs to `/api/v1/passport/agents/:subject_commitment/evidence`.
4. **ENROLLED status** — Public profiles expose `enrollment_status`. After at least one signed evidence item persists under the issued commitment, `GET /api/v1/profiles/:subject_commitment` returns `enrollment_status: "ENROLLED"`.

Status semantics (`PENDING`, `ISSUED`, `UNENROLLED`, failure codes) are defined in [passport-agent-enrollment.md](./passport-agent-enrollment.md#status-semantics).

## Endpoints and signing (by reference)

| Step | Route | Signing rule |
|---|---|---|
| Start | `POST /api/v1/passport/agents/enroll/start` | None (public key in body) |
| Complete | `POST /api/v1/passport/agents/enroll/complete` | Sign `UTF-8(challenge_nonce)` → 128-hex signature |
| Evidence | `POST /api/v1/passport/agents/:id/evidence` | Sign `UTF-8(sourceDigest(payload))` → 128-hex signature |
| Profile | `GET /api/v1/profiles/:hash` | None |

Request/response shapes, validation rules, and curl examples: [passport-agent-enrollment.md](./passport-agent-enrollment.md#api-contract).

## Hello-world walkthrough

### 1. Start Passport locally

PowerShell:

```powershell
cd "C:\Users\izzyb\Downloads\continual-harness-main\passport"
npm install
# Copy .env.example -> .env and adjust values if needed.
npm run check:env
npm run db:status
$env:NEXT_PUBLIC_APP_URL = "http://localhost:3000"
npm run dev
```

The stack helper remains available as `npm run dev:passport-stack`; it checks
env/database preflight, reuses an already healthy `http://localhost:3000`, and
refuses to fall through to a second Next dev server on port 3001 when port 3000
is stale or unhealthy. On Windows, prefer the direct preflights plus
`npm run dev` path above for live local testing.

Confirm: `curl http://localhost:3000/api/health` -> `{"status":"ok"}`.

PowerShell health and smoke checks:

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/api/health" -Headers @{Accept="application/json"} -UseBasicParsing
$env:BASE_URL = "http://localhost:3000"
npm run smoke:agent-enrollment
```

Success criteria: health returns HTTP 200, the smoke prints all four `[PASS]`
lines, and the final marker is `SMOKE_PASS agent-enrollment`.

If you need PostgreSQL locally instead of the default SQLite dev URL, start it
first and set `DATABASE_URL` in `.env`; do not change the enrollment/evidence
protocol.

### 2. Derive agent key and commitment

Generate a 32-byte ed25519 seed (64 hex chars):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use `@noble/ed25519` to derive the public key and local commitment before calling Passport.

### 3. Enroll (start → sign → complete)

```bash
# POST enroll/start with public_key (+ optional context)
# Verify returned subject_commitment matches local derivation
# Sign UTF-8(challenge_nonce), POST enroll/complete
```

### 4. Submit one evidence item

Pick a supported `source_type` (`compliance_report`, `github_push_webhook`, etc.), normalize the payload, compute `sourceDigest(payload)`, sign the digest, POST to `/api/v1/passport/agents/:subject_commitment/evidence`.

### 5. Confirm ENROLLED

```bash
curl http://localhost:3000/api/v1/profiles/<64-hex-subject-commitment>
# expect enrollment_status: "ENROLLED"
```

Operator verification: `BASE_URL=http://localhost:3000 npm run smoke:agent-enrollment` (see [passport-enrollment-ops.md](./passport-enrollment-ops.md)).

## Reference-agent live loop

After Passport is healthy on port 3000, point the reference agents at it.

PowerShell:

```powershell
cd "C:\Users\izzyb\Downloads\continual-harness-main\3 aaamigas"
$env:PASSPORT_BASE_URL = "http://localhost:3000"
npm run demo:repo-steward-passport
npm run demo:issue-triage-passport
npm run demo:compliance-passport
```

Bash:

```bash
cd "../3 aaamigas"
export PASSPORT_BASE_URL=http://localhost:3000
npm run demo:repo-steward-passport
npm run demo:issue-triage-passport
npm run demo:compliance-passport
```

One-command Bash form for any external agent process:

```bash
PASSPORT_BASE_URL=http://localhost:3000 npm run <agent-command>
```

Passport-side success looks like:

- `curl http://localhost:3000/api/health` returns `{"status":"ok"}`.
- `BASE_URL=http://localhost:3000 npm run smoke:agent-enrollment` prints all four PASS lines, `All agent enrollment smoke probes passed.`, and `SMOKE_PASS agent-enrollment`.
- The Next dev console shows each agent demo hitting `enroll/start`, `enroll/complete`, `evidence`, and profile routes with 2xx responses.
- Each reference-agent demo prints enrollment/evidence status, including `ISSUED`, `ENROLLED`, and profile `enrollment_status: "ENROLLED"`.

## Minimal Node snippet (no 3 aaamigas repo)

Standalone enroll + one evidence item using `@noble/ed25519` and `@noble/hashes`:

```typescript
import { getPublicKey, sign } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

const BASE = "http://localhost:3000";
const CONTEXT = "passport-v1";

function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}

function deriveAgentCommitment(publicKeyHex: string, context = CONTEXT): string {
  return sha256Hex(`agent-id:${publicKeyHex.toLowerCase()}:${context}`);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort());
}

function sourceDigest(payload: unknown): string {
  return sha256Hex(canonicalJson(payload));
}

// 1. Keypair
const privateKey = hexToBytes("<64-hex-seed>");
const publicKeyHex = bytesToHex(getPublicKey(privateKey)).toLowerCase();
const subjectCommitment = deriveAgentCommitment(publicKeyHex);

// 2. enroll/start
const startRes = await fetch(`${BASE}/api/v1/passport/agents/enroll/start`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ public_key: publicKeyHex, context: CONTEXT }),
});
const start = await startRes.json();
if (start.subject_commitment !== subjectCommitment) throw new Error("commitment mismatch");

// 3. enroll/complete
const completeSig = bytesToHex(await sign(utf8ToBytes(start.challenge_nonce), privateKey));
await fetch(`${BASE}/api/v1/passport/agents/enroll/complete`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ subject_commitment: subjectCommitment, signature: completeSig }),
});

// 4. evidence
const payload = {
  agent_identity: "hello.agent",
  control_domain: "demo",
  report: { id: "r1", url: "https://example.com/r", title: "Hello" },
  action: "report_created",
  observed_at: new Date().toISOString(),
};
const evidenceSig = bytesToHex(await sign(utf8ToBytes(sourceDigest(payload)), privateKey));
const evidenceRes = await fetch(`${BASE}/api/v1/passport/agents/${subjectCommitment}/evidence`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ source_type: "compliance_report", payload, signature: evidenceSig }),
});
console.log(await evidenceRes.json()); // enrollment_status: "ENROLLED"

// 5. profile
const profile = await fetch(`${BASE}/api/v1/profiles/${subjectCommitment}`).then((r) => r.json());
console.log(profile.enrollment_status); // "ENROLLED"
```

Run with: `npx tsx hello-agent.ts` (after `npm install @noble/ed25519 @noble/hashes`).

## Next steps

- **Operator checklist:** [passport-enrollment-ops.md](./passport-enrollment-ops.md) (rate limits, structured logging, contract check)
- **Deployment contract check:** `npm run check:contract -- --base-url <url>` — see [passport-enrollment-ops.md#health--contract-check](./passport-enrollment-ops.md#health--contract-check)
- **Reference client:** [3 aaamigas/docs/passport-client-reference.md](../../3%20aaamigas/docs/passport-client-reference.md)
- **Fresh-checkout runbook:** [3 aaamigas/docs/passport-enrollment-runbook.md](../../3%20aaamigas/docs/passport-enrollment-runbook.md)
