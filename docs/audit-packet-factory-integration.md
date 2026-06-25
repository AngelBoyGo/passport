# Audit Packet Factory integration note

Audit Packet Factory is the primary wedge. Passport Reputation remains the canonical trust and evidence substrate for APF receipts, but this handoff does not require a protocol or schema change.

## Current fit

APF can use the existing enrolled evidence path:

1. Enroll the APF operator agent through `POST /api/v1/passport/agents/enroll/start` and `POST /api/v1/passport/agents/enroll/complete`.
2. Store the issued `subject_commitment`, public key, context, and private-key reference in APF state.
3. Build the APF signed evidence payload as `source_type: "compliance_report"`.
4. Compute `payload_digest = sourceDigest(payload)` using Passport-compatible canonical JSON.
5. Sign `UTF-8(payload_digest)` with the enrolled ed25519 key.
6. Submit `POST /api/v1/passport/agents/:subject_commitment/evidence`.
7. Store Passport Reputation's `event_commitment_hash` and `enrollment_status` alongside APF's local receipt record.
8. Present APF's public verify view from the stored payload, signature, public key, payload digest, event commitment, enrollment status, and packet completeness/gaps.

The current Passport Reputation substrate already covers APF's minimum operator-tooling needs:

- Source links and artifacts: `compliance_report.report.url`, `report.id`, `report.title`, and APF's local packet artifact/digests.
- Timestamps: `observed_at` on the Passport evidence payload and APF packet/run timestamps.
- Evidence/source type: `source_type: "compliance_report"` in Passport and `sourceType` on the APF receipt row.
- Subject commitment: issued enrollment `subject_commitment`, persisted in APF as `subjectCommitment`.
- Event commitment hash: Passport returns `event_commitment_hash`; APF stores it as `eventCommitmentHash`.
- Completeness and gaps: APF owns packet completeness/gap semantics and stores them on `EvidencePacket`; Passport should not decide APF customer-facing completeness language.

## Payload shape for APF

APF should keep using this narrow payload shape unless pilot evidence shows a real blocker:

```json
{
  "agent_identity": "agent.compliance-evidence.v1",
  "control_domain": "CC8.1",
  "report": {
    "id": "chg-auth-rollout-abc123",
    "url": "https://github.com/acme/repo/pull/42",
    "title": "Deploy auth service"
  },
  "action": "report_created",
  "completeness": "complete",
  "public_summary": "Change chg-auth-rollout-abc123 evidence assembled for CC8.1.",
  "observed_at": "2026-06-20T10:00:00.000Z",
  "agent_artifact_digest": "<64-hex>",
  "agent_event_digest": "<64-hex>"
}
```

Passport Reputation normalizes the fields it understands and ignores unknown payload fields. APF can therefore carry APF-owned packet data such as `completeness`, `public_summary`, `agent_artifact_digest`, and `agent_event_digest` without expanding the Passport schema.

## Readback and presentation

For APF's lightweight operator tool, use APF's local receipt row as the public proof read model:

- Re-derive `sourceDigest(payload)`.
- Verify the ed25519 signature against the stored public key.
- Compare the derived digest with APF's stored `payloadDigest`.
- Show Passport Reputation `eventCommitmentHash`, `subjectCommitment`, and `enrollmentStatus`.
- Show APF-owned `completeness`, `gaps`, `artifactDigest`, and `eventDigest`.

Passport Reputation public profiles and manifests remain available for substrate-level readback, but APF should not depend on a new Passport public manifest shape for the next phase.

## Deployment contract check

Passport ships a first-party read-only checker APF (and other consumers) can run against any deployment. APF operator checklist and consolidated failure triage: [pilot-support-runbook.md — INTEGRATION CHECKLIST (APF)](./pilot-support-runbook.md#integration-checklist) and [COMMON_FAILURES](./pilot-support-runbook.md#common_failures).

```bash
cd passport
npm run check:contract -- --base-url https://passport.example.com --subject-commitment <64-hex> --expect-enrollment-status ENROLLED
```

It verifies health, public-key availability, and — when a subject commitment is supplied — that profile readback includes `enrollment_status` without leaking APF-owned `completeness` / `gaps` on the public profile surface. Full operator notes: [passport-enrollment-ops.md](./passport-enrollment-ops.md#health--contract-check).

## Intentional boundaries

Do not change Passport Reputation for these APF concerns without a concrete pilot blocker:

- Compliance claims or customer-facing packet wording.
- Retention, deletion, or visibility policy.
- Broad protocol redesign.
- New receipt or evidence schema fields for APF-only concepts.
- Branding changes away from Passport Reputation.

If APF later needs Passport Reputation to publicly expose APF-specific completeness or packet copy, treat that as a founder-level product decision first, then add the smallest backward-compatible read model needed.
