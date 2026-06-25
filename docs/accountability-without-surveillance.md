# Accountability without surveillance

How Passport maps **action-first accountability** to a forensic record — without building an identity surveillance product. This doc is additive ops guidance only; it does not change protocol, schema, routes, signing, or receipt format.

Related: [pilot-support-runbook.md](./pilot-support-runbook.md) · [passport-agent-enrollment.md](./passport-agent-enrollment.md) · [audit-packet-factory-integration.md](./audit-packet-factory-integration.md)

---

## Action-first vs identity surveillance

| Lens | Action-first accountability (Passport) | Identity surveillance (not Passport) |
|------|----------------------------------------|-------------------------------------|
| Primary question | Did this **specific action** happen, with integrity? | Who is this agent **as a person/org**, and how do they score over time? |
| Audit unit | One evidence event: digest + signature + commitment hash | Persistent profile dossier, behavioral scoring, HR-style completeness |
| Trust anchor | Cryptographic proof over normalized payload | Ongoing observation, reputation aggregation, third-party ratings |
| Operator workflow | Verify a receipt packet; grep logs by `reason_code` | Monitor agents, rank completeness, enforce policy on identity |

Passport is inspired by **action-primary** community patterns (agents prove discrete events, not personas) but is **not** a copy of any external product. Passport stays a **receipt-evidence substrate**: enrollment binds a key to a commitment hash; evidence binds signed payloads to event commitment hashes.

---

## Primary audit unit

The forensic record for a single submission is three linked fields on the **same frozen substrate**:

| Field | Role |
|-------|------|
| `payload_digest` | `sourceDigest(payload)` — Passport-compatible canonical JSON SHA-256 |
| ed25519 `signature` | Agent signs `UTF-8(payload_digest)` (not raw JSON) |
| `event_commitment_hash` | Server-issued commitment for the normalized evidence row |

Together with `subject_commitment` (path identity) and stored `public_key`, an operator or downstream product can **re-derive the digest**, **verify the signature**, and **match the event hash** without trusting Passport's UI alone.

Local verification (no writes):

```bash
npm run verify:receipt -- \
  --payload path/to/payload.json \
  --signature <128-hex> \
  --public-key <64-hex> \
  --base-url https://passport.example.com \
  --subject-commitment <64-hex>
```

Digest-only (no signature):

```bash
npm run verify:receipt -- --payload '{"source_type":"compliance_report",...}'
```

---

## Two layers, same substrate

Passport maintains **operational logs** and a **forensic record** — both from the same enrollment/evidence routes, different purposes:

```text
Client POST evidence
        │
        ├─► Forensic record (durable)
        │     AgentEvidence row: sourceDigest, eventCommitmentHash, …
        │     Profile readback after enrollment
        │
        └─► Operational logs (ephemeral, grep-friendly)
              JSON lines: event, reason_code, http_status, subject_commitment, …
              stdout/stderr — triage before opening the DB
```

| Layer | Use | Typical tools |
|-------|-----|----------------|
| **Operational logs** | Live triage: rate limits, `not_enrolled`, `invalid_proof`, 5xx | `grep` / `Select-String` on pilot log files ([runbook](./pilot-support-runbook.md#first-incident-triage)) |
| **Forensic record** | Post-incident proof: recompute digest, verify signature, store `event_commitment_hash` | `npm run verify:receipt`, downstream receipt rows, APF verify views |

Logs answer **what failed and why** in the request window. The forensic triple answers **whether this payload was bound to this commitment** independent of server logs.

---

## What Passport refuses

Passport intentionally does **not** become:

- **Human HR scoring** — no performance grades, no "agent quality" index on the public profile
- **APF completeness on profile** — `completeness` / `gaps` stay downstream (APF-owned); contract check fails if they leak onto Passport profiles
- **Surveillance-by-default** — no mandatory continuous telemetry beyond signed evidence the agent submits
- **Identity dossier product** — `subject_commitment` is a hash-bound key identity, not a legal identity graph
- **Silent schema expansion** — unknown payload fields are ignored; substrate fields are frozen unless explicitly approved ([branching.md](./branching.md))

Downstream products (Repo Passport, APF) own customer language, packet artifacts, and completeness semantics. Passport owns **signed event binding** only.

---

## Operator path

1. **Contract** — deployment reachable (`npm run check:contract`)
2. **Logs** — grep by `subject_commitment`, `event`, `reason_code`
3. **Forensic verify** — `npm run verify:receipt` on captured payload + signature
4. **Profile** — readback last; 404 before first evidence is expected, not "broken Passport"

Full triage order: [pilot-support-runbook.md — First Incident Triage](./pilot-support-runbook.md#first-incident-triage).

---

## Feature branch note

Action-primary forensics (this doc + `verify:receipt` CLI) ships on `feature/passport-action-primary-forensics` — docs and read-only tooling only, no substrate changes.
