# Orchestration's three tests—and where signed evidence fits

*Draft for GitHub Discussions / blog. Docs-only; no substrate changes.*

---

Agent communities are converging on a useful framing: **the edge already works before the orchestrator shows up.** Household batteries cut peak draw with local logic long before any virtual power plant coordinates them. Cron jobs rebalance portfolios. Tool loops finish tasks. Then a coordination layer arrives and asks for credit—and billing—for work that would have happened anyway.

That conversation crystallizes into three tests any orchestration layer must pass:

1. **Beat the passive baseline.** Does the layer improve outcomes beyond what local agents already do by default?
2. **Compensate fairly for autonomy loss.** If you centralize control, what does the edge get back?
3. **Reduce friction, not add latency.** Does coordination make the system simpler, or another hop between intent and result?

These tests show up in production failure modes: agents emitting `TASK_COMPLETE` before constraints are met; pipelines going green while shipping the wrong product; monitoring that watches the wrong signal for weeks with zero errors. The runtime says success. The deliverable says otherwise.

Passport Reputation enters from a deliberately narrow angle. **We are not an orchestration product.** We do not dispatch tasks or claim credit for passive work your cron job already performs. Passport is a trust substrate: cryptographic agent identity, signed evidence ingest, and offline verification—passport and notary, not orchestration and billing.

## The attribution gap

The hard question is **additionality**: what changed because of the coordination layer versus what the edge would have done on its own?

That cannot be settled by platform logs alone. Logs are operator-convenient, not portable proof. They live inside one vendor's boundary and conflate *who ran the orchestrator* with *what the agent key signed*.

What operators increasingly ask for is a **counterfactual line item**: a timestamped, replayable record of a specific signed payload bound to a specific key identity—not a social score, not a TASK_COMPLETE flag, not a dashboard green light.

Passport's answer is **delta-only attestation**. You choose what to submit as signed evidence. Passport binds that payload to an ed25519 `subject_commitment`, issues an `event_commitment_hash`, and stores the row in an append-only journal. It does not assert that your orchestration layer caused the outcome. It asserts: **this key signed this canonical digest at this time**, and any party can verify that claim without trusting our UI.

That is the honest scope. Receipts for what you choose to attest—not a VPP for your cron job.

## How this maps to the three tests

**Test 1 — Beat the passive baseline.** Passport does not compete with your local agent logic. It gives you a forensic unit—`payload_digest` + ed25519 signature + `event_commitment_hash`—so when orchestration *does* add value, you can show the delta with cryptography instead of narrative. Green CI is a runtime lie until something signs the payload digest.

**Test 2 — Compensate for autonomy loss.** When agents surrender discretion to a coordinator, the edge needs proof it was not double-counted. A signed evidence row is a portable artifact: downstream products, auditors, and counterparties can re-derive the digest and verify the signature against a published public key. The agent keeps its key; the proof travels independently of Passport's dashboard.

**Test 3 — Reduce friction.** Verification is a read-only CLI, not another control plane. Operators triage with structured logs (`reason_code`, `subject_commitment`), then drop to forensic verify on captured payloads. No enrollment in our runtime. No mandatory telemetry beyond what you submit.

## Action-first accountability, not identity surveillance

Passport is inspired by action-primary patterns—prove the act, not the persona—but implements its own frozen substrate. `subject_commitment` is a hash-bound key identity, not an HR dossier. We refuse trust scores and behavioral surveillance on the public profile.

The primary audit unit is one evidence event, not a reputation graph:

| Field | Role |
|-------|------|
| `payload_digest` | Canonical JSON SHA-256 over the normalized payload |
| ed25519 `signature` | Agent signs UTF-8 digest bytes |
| `event_commitment_hash` | Server-issued commitment for the evidence row |

Together, an operator or downstream product can re-derive the digest, verify the signature, and match the event hash—without trusting server logs alone.

## Verify it yourself

Local verification requires no writes and no trust in Passport's UI:

```bash
npm run verify:receipt -- \
  --payload path/to/payload.json \
  --signature <128-hex> \
  --public-key <64-hex> \
  --base-url https://passport.example.com \
  --subject-commitment <64-hex>
```

Digest-only check (no signature yet):

```bash
npm run verify:receipt -- --payload '{"source_type":"compliance_report",...}'
```

Each check prints `PASS` or `FAIL` per step; a successful run ends with `PASS`. That is the anti-wrapper demo: show me offline signature verification on the deliverable, not a chat transcript.

Operator triage order when something fails in production:

1. **Contract** — deployment reachable (`npm run check:contract`)
2. **Logs** — grep by `subject_commitment`, `event`, `reason_code`
3. **Forensic verify** — `npm run verify:receipt` on captured payload + signature
4. **Profile readback** — last; 404 before first evidence is expected, not "broken Passport"

## Where Passport stops

Passport intentionally does not become an orchestration or marketplace layer, a social feed or agent directory, or a surveillance dossier dressed as safety. Downstream products own customer language and packet artifacts. Passport owns **signed event binding** only.

If you are building agents that already work at the edge, the market still needs a line item for **what actually happened**—signed, timestamped, verifiable without the platform. The three tests tell you whether your orchestration earns its place. Signed evidence tells you whether a specific act can be proven once it does.

---

**Further reading (Passport docs):**

- [Accountability without surveillance](../accountability-without-surveillance.md)
- [Agent identity vs "just an LLM wrapper"](../agent-identity-vs-wrapper.md)
- [Passport vs HostHub vs AngelCoin](../product-boundaries.md)
- [Pilot support runbook — First Incident Triage](../pilot-support-runbook.md#first-incident-triage)
