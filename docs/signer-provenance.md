# Signer Provenance & Fail-Closed Verification

_Phase 38. Makes "signature verified" imply "authorized by a pinned identity", everywhere._

## Why

Before Phase 38, several value-moving paths verified a signature against a **caller-supplied
public key** (`input.signerPublicKey || registeredKey`, `providedPublicKey`, etc.). Since the
caller controls both the signature and the key, "verified" was meaningless: anyone could
self-assert a keypair and forge sovereign quorum votes, milestone payouts, swarm bounty
actions, transit arrivals, and smelting telemetry.

## Policy

A signature check is valid **only** against a key resolved from one of:

1. **Env** — e.g. `SOVEREIGN_KEY_ML/BF/NE`, `MILESTONE_VERIFIER_KEYS`.
2. **DB registry** — e.g. `ArtisanalBuyingStation.stationPublicKey`,
   `CoastalPortEnclave.enclavePublicKey`, `CustomsCheckpoint.inspectorPublicKey`,
   `IndustrialMiningConcession.smelterHsmPublicKey`, `AgentEnrollment.publicKey`.
3. **Genesis benchmark** — deterministic test keys, used **only when not enforced** (never in
   production).

Rules:

- A `public_key` / `signer_public_key` supplied in a request body is accepted for backward
  compatibility but is **never** the verification key.
- If a supplied key is present and differs from the pinned key: reject (HTTP 401) and emit a
  security event.
- No pinned key + enforcement on: reject (fail closed).

## Enforcement gate

`signaturesEnforced()` is `true` when `NODE_ENV === "production"` **or**
`ENFORCE_SIGNATURES === "1"`. Staging should set `ENFORCE_SIGNATURES=1` so it enforces without
pretending to be production.

## Helper

`src/lib/auth/verifyPinnedSignature.ts`

```ts
const result = await verifyPinnedSignature({
  pinnedKey,        // trusted key (env/registry) — never request input
  providedKey,      // optional caller key, only checked for mismatch
  signatureHex,
  signPayload,      // string => signed as raw UTF-8; object => canonicalJson
  context,          // e.g. "reserves.quorum.sign" (telemetry source_type)
  commitment,       // telemetry subject_commitment
});
// => { valid: true } | { valid: false, reason: <enum> }
```

Reject reasons: `missing_pinned_key`, `provided_key_mismatch`, `malformed_key`,
`malformed_signature`, `signature_mismatch`, `verification_error`.

Every rejection logs a `signature_provenance_rejected` event (via `logPassportEvent`) with the
operation, commitment, and reason — treat these as intrusion signals.

## Hardened paths (Phase 38)

| Path | Pinned source |
| --- | --- |
| `reserves/quorum/sign` | `SOVEREIGN_KEY_<STATE>` env (prod fail-closed) |
| `reserves/industrial/smelt` | `IndustrialMiningConcession.smelterHsmPublicKey` |
| `reserves/transit/arrive` | `CoastalPortEnclave.enclavePublicKey` |
| `reserves/transit/checkpoint` | `CustomsCheckpoint.inspectorPublicKey` |
| `reserves/fund/milestones` | `MILESTONE_VERIFIER_KEYS` allowlist (prod fail-closed) |
| `swarm/*` signatures | `AgentEnrollment.publicKey` (prod fail-closed if unenrolled) |

Already correct before Phase 38: `reserves/artisanal/intake` (pinned to the buying station's
spectrometer key).

## Non-regressable

`src/lib/auth/__tests__/signer-provenance-inventory.test.ts` enumerates every direct `verify(`
call site in `src/` (excluding tests) and fails unless the file delegates to
`verifyPinnedSignature` or is listed in `APPROVED_VERIFY_CALL_SITES` with a justification. A
new self-asserted-signer path therefore fails the test suite by name. A companion check fails on
stale allowlist entries.

## Environment

| Var | Meaning |
| --- | --- |
| `ENFORCE_SIGNATURES` | `"1"` enforces signature provenance outside production (e.g. staging). |
| `SOVEREIGN_KEY_ML` / `_BF` / `_NE` | 64-hex Ed25519 public keys of the sovereign quorum states. Required in production. |
| `MILESTONE_VERIFIER_KEYS` | Comma-separated 64-hex Ed25519 public keys authorized to verify stabilization milestones. Required in production. |

## Out of scope

No DB schema changes and no key rotation were part of Phase 38. Paths that still verify against a
key carried inside the signed artifact (e.g. PoR attestations, offline receipt verification) are
listed in the inventory allowlist and track as follow-ups if a pinned-source design is desired.
