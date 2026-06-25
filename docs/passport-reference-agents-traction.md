# Passport Reference Agents: Evidence Bridge Traction

Execution doc for the three 3-aaamigas reference agents as first-class Passport evidence subjects. This is additive, library-first documentation — no schema migration, no HTTP ingestion route yet.

**Related docs:**

- [Passport + GitHub Evidence: Operator Rollout Runbook](./passport-github-rollout.md)
- [Passport AngelCoin Proof Packet](./passport-angelcoin-proof-packet.md)
- [Agent Passport Enrollment](./passport-agent-enrollment.md)

## 1. Why GitHub is the wedge

GitHub is where agent work already leaves durable artifacts: commits, pull requests, and issue activity. Passport already ingests GitHub push/commit payloads into `AgentEvidence` with privacy-preserving commitments (`INGESTION_COMMITMENT_SALT`). The reference-agent bridge extends that same pipeline to issue-triage and compliance-report payloads without new tables or enums — `sourceType`, `artifactType`, and `normalizedEventType` are plain strings.

Operators get a single dedup-safe evidence store, a public masked profile/leaderboard, and an optional evidence→receipt bridge. GitHub-shaped events are the lowest-friction path to demonstrate value before live 3-aaamigas integration.

## 2. Why these three agents matter

| Agent | Registry key | Raw identity |
|---|---|---|
| Repo Steward | `REPO_STEWARD` | `agent.repo-steward.v1` |
| Issue Triage Agent | `ISSUE_TRIAGE` | `agent.issue-triage.v1` |
| Compliance Evidence Agent | `COMPLIANCE_EVIDENCE` | `agent.compliance-evidence.v1` |

For anonymous/library fixture ingestion, each agent maps to a stable observed 64-hex `agentIdentityCommitment` via `commit(rawIdentity)` in `src/lib/reference-agents/registry.ts`. When a reference agent holds an ed25519 keypair and uses the external enrollment route, its Passport identity is the key-derived `subject_commitment` from `passport-agent-enrollment.md`; signed evidence persists under that issued commitment.

## 3. What each agent produces

| Agent | Primary artifacts | Source types |
|---|---|---|
| Repo Steward | Commits, pull requests | `github_push_webhook`, `github_commit_payload` |
| Issue Triage | Issue triage output, label updates, operator accept/override | `github_issue_event` |
| Compliance Evidence | Control-mapping / gap reports, human approval or rejection | `compliance_report` |

## 4. What Passport captures (contract → AgentEvidence)

| Contract field | AgentEvidence / masked field | Notes |
|---|---|---|
| `agent_identity` / commit author | `agentIdentityCommitment` | Salted SHA-256 of raw identity for anonymous/library ingestion; enrolled evidence is stored under the issued key-derived commitment |
| Repository / control domain | `repositoryCommitment` | Repo name or control domain string |
| Commit SHA | `commitSha` | Repo Steward primary dedup key |
| Issue id / report id | Drives `eventCommitmentHash` via in-memory `artifact_identifier` fallback | Not a DB column; dedup uses `commitSha ?? artifact_identifier ?? sourceUrl` |
| Artifact URL | `sourceUrl` | Issue or report URL |
| Transcript / session log URL | `sessionLogUrlCommitment` | Salted commitment |
| Operator accept / approval | `validationSignalPresent` | Recorded; not required for eligibility |
| Override / rejection | `normalizedEventType` = `HUMAN_CORRECTION_OBSERVED` | Maps to profile outcome `corrected` |
| Triage output / report created | `normalizedEventType` = `AGENT_ARTIFACT_CREATED` | Maps to profile outcome `produced` |
| Event time | `observedAt` | ISO timestamp |
| Semantic dedup | `eventCommitmentHash` | Unique upsert key; GitHub commit hashes unchanged (backward compatible) |

Normalization entry point: `normalizeEvidence({ sourceType, payload })` in `src/lib/ingestion/github-agent-adapter.ts`.

## 5. Success criteria per agent

### Repo Steward

- [ ] Push/commit payload normalizes to `AGENT_ARTIFACT_CREATED` with non-null `commitSha`
- [ ] `agentIdentityCommitment` matches `REFERENCE_AGENTS.REPO_STEWARD.subjectCommitment` when author is `agent.repo-steward.v1`
- [ ] Replay of the same commit yields the same `eventCommitmentHash` (persist no-op)
- [ ] Public profile timeline shows `outcome: "produced"`

### Issue Triage

- [ ] Issue payload normalizes with `sourceType: github_issue_event` and label-aware `artifactType`
- [ ] Override/revert maps to `HUMAN_CORRECTION_OBSERVED` / outcome `corrected`
- [ ] Accept sets `validationSignalPresent: true`
- [ ] Dedup stable on `artifact_identifier` (issue id) when `commitSha` is null
- [ ] No raw identity or transcript URL in commitment fields

### Compliance Evidence

- [ ] Report payload normalizes with `sourceType: compliance_report`
- [ ] Control domain committed via `repositoryCommitment`
- [ ] Rejection → `HUMAN_CORRECTION_OBSERVED`; approval → `validationSignalPresent: true`
- [ ] `evaluateReceiptEligibility` passes when `sourceUrl` or dedup hash is well-formed

## 6. Receipt eligibility (additive predicate)

`evaluateReceiptEligibility` in `src/lib/reference-agents/receipt-eligibility.ts` is a pure v1 predicate. It does **not** rewire `bridgeEvidenceToReceipt`.

Required for `eligible: true`:

1. Valid 64-hex `agentIdentityCommitment`
2. Artifact identifier present (`commitSha` or `sourceUrl`)
3. Valid 64-hex `eventCommitmentHash`
4. Sufficiently formed row (`sourceType`, `normalizedEventType`, finite `observedAt`)

Optional bonus reason: `human_validation_present` when `validationSignalPresent` is true.

Eligibility confirms the row is well-formed and dedup-safe. Existing `classifyEnforcement` then assigns `OBSERVATIONAL_ONLY` vs `AUDIT_RELEVANT` vs `ENFORCEMENT_ELIGIBLE` from event type and validation signals.

## 7. First live demo flow

1. **Agent runs** — one of the three reference agents produces a GitHub commit, issue-triage payload, or compliance report JSON (fixtures in `src/lib/reference-agents/tests/fixtures/`).
2. **Visible artifact** — commit lands on GitHub, or operator receives triage/report output with URL and transcript link.
3. **Passport ingests (library)** — call `normalizeEvidence` → `toMaskedEvidence` → `persistEvidence` from application code or script (no HTTP route yet).
4. **Dedup works** — replay the same payload; upsert on `eventCommitmentHash` is a no-op (`update: {}`).
5. **Profile updates** — `GET /api/v1/profiles/:hash` where `:hash` is the observed fixture commitment or the enrolled key-derived `subject_commitment`; timeline entries include additive `outcome` (`produced`, `corrected`, `validated`, `failed`, `observed`).
6. **Receipt-eligible event** — when `evaluateReceiptEligibility(masked)` returns `eligible: true`, the row is ready for optional bridging (requires `EVIDENCE_BRIDGE_OPERATOR_ID`).
7. **Public manifest** — bridged receipts expose masked `GET /api/v1/receipts/:id/public-manifest` with verification and optional enforcement linkage.

### Demo checks (scriptable)

```typescript
import { REFERENCE_AGENTS } from "@/lib/reference-agents/registry";
import {
  normalizeEvidence,
  toMaskedEvidence,
  persistEvidence,
} from "@/lib/ingestion/github-agent-adapter";
import { evaluateReceiptEligibility } from "@/lib/reference-agents/receipt-eligibility";
import { getAgentProfile } from "@/lib/public-portal/portal-service";

// 1. Normalize + persist
const records = normalizeEvidence({ sourceType: "github_issue_event", payload });
const masked = toMaskedEvidence(records[0]);
await persistEvidence([masked]);

// 2. Eligibility
const eligibility = evaluateReceiptEligibility(masked);

// 3. Profile
const profile = await getAgentProfile(REFERENCE_AGENTS.ISSUE_TRIAGE.subjectCommitment);
```

## 8. Architecture summary

```
reference-agents/registry.ts     → stable rawIdentity + observed fixture commitment
github-agent-adapter.ts          → normalizeEvidence + toMaskedEvidence + persistEvidence
reference-agents/receipt-eligibility.ts → evaluateReceiptEligibility (pure)
public-portal/portal-service.ts  → getAgentProfile timeline.outcome
evidence-bridge/                 → bridgeEvidenceToReceipt (unchanged mint path)
```

**No schema migration:** new `sourceType` / `artifactType` values are plain strings. Dedup hash backward compatibility: GitHub events still use `commit_sha` as the primary hash component; issue/report events use `artifact_identifier` or `source_url` fallback.

## 9. Remaining gaps before live 3-aaamigas integration

- **No HTTP ingestion route** — library-first; operators must call `normalizeEvidence` / `persistEvidence` from scripts, webhooks, or future routes.
- **No 3-aaamigas repo changes** — enrolled agents should emit payloads matching the normalized event contracts in `src/lib/reference-agents/tests/fixtures/` and submit them through the generic signed evidence route.
- **Bridge operator provisioning** — `EVIDENCE_BRIDGE_OPERATOR_ID` and seeded minter still required for receipt minting (see rollout runbook).
- **Live GitHub webhook wiring** — push events for Repo Steward; custom forwarder needed for issue/compliance JSON until HTTP ingestion ships.
