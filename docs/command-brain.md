# Command Brain — scope, features, actions, memory

The **Command Brain** is a single central AI supervisor for the Passport / AngelCoin / agent
economy. Each cycle it observes the whole system, decides exactly **one** bounded action, records
what it did, and conditions on its own history. It runs through the `api.metis.gold` KeyForge
gateway (`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`).

It is deliberately constrained: it is a **supervisor, not a sovereign**. It can never move money,
change balances, mint, or bypass the safety interlock.

## Audit — what a central brain can safely manage

| Domain | Manageable by the brain | Why |
| --- | --- | --- |
| Rail health | ✅ quarantine a failing/broken rail | reversible, audited, already exists (`quarantineRailSpec`) |
| Discovery cadence | ✅ trigger `/discover` when stale | idempotent, read-mostly |
| Execution/health cadence | ✅ run `/tick` (dry-run only) | never moves money |
| Integrity | ✅ trigger an attestation when issues appear | append-only evidence |
| Disputes | ✅ flag a dispute for attention (advisory) | jurors decide; the brain must not vote |
| Economy tuning | ⚠️ recommend only | fee/peg changes are governance, not the brain |
| Money movement | ❌ never | only `/settle` + reserve services may move value |
| Key custody / interlock | ❌ never | human/ISSUER-only |

## Features the brain needs

1. **Observability** — a single datapoint snapshot each cycle.
2. **Bounded action space** — an explicit allowlist, validated before execution.
3. **Persistence** — append-only memory across cycles.
4. **Learning** — a playbook of per-action success rates fed back into the prompt.
5. **Fail-closed** — LLM/transport failure ⇒ NOOP, never a guessed action.
6. **Auditability** — every decision + outcome recorded with the cycle id.
7. **Guardrails** — no money-moving action, allowlist-only, rate-limited, ISSUER/scheduler auth.

## Action steps the brain may take

`NOOP`, `RECORD_NOTE`, `RUN_DISCOVERY`, `RUN_TICK`, `TRIGGER_ATTESTATION`,
`QUARANTINE_RAIL`, `INVESTIGATE_DISPUTE` (advisory). Everything else is rejected and resolved to
`NOOP`.

## Persistent memory & learning

Memory is the `BrainMemory` table (append-only). Each cycle writes:
- an **OBSERVATION** (the datapoints it saw + composite `health_score`),
- a **DECISION** (the chosen action + rationale),
- an **OUTCOME** (`action -> ok|error`).

The next cycle's prompt includes the last N memory rows **and a playbook** — per-action
`successRate` computed from OUTCOME rows (`summarizePlaybook`). This is the learning loop: the
model is told which actions have actually worked, so it favors them over time. Because memory is
in the DB, context persists across process restarts.

## Datapoints fed each cycle

From `gatherDatapoints()`: economy health (supply, reserve, coverage, external-revenue share,
velocity, disputes, verifications, capabilities, offers, pipeline jobs), integrity status+issues,
rail counts (enabled/quarantined), open disputes, and a composite `health_score`
(`computeHealthScore`: penalties for under-collateralization, integrity failure, disputes).

## Endpoints

- `POST /api/v1/raillab/brain/cycle` — run one cycle (ISSUER key or `x-scheduler-secret`).
- `GET  /api/v1/raillab/brain/memory?kind=&limit=` — recent memory (ISSUER).

## Gateway configuration

Set in `.env` (gitignored, never committed):

```
LLM_BASE_URL=https://api.metis.gold/api/gateway/v1
LLM_API_KEY=vk_...            # KeyForge virtual key (scope/quota/spend-cap enforced by the gateway)
LLM_MODEL=gpt-4o-mini
```

The same gateway powers the Rail Factory brain (`src/lib/raillab/factory-brain.ts`).

## Guardrails (never-do)

- Never mint, burn, transfer, settle, or redeem.
- Never clear the execution-safety interlock.
- Never touch signer/operator keys.
- Never act outside the allowlist; unknown proposals resolve to `NOOP`.
- Never act on an LLM failure — fail closed.