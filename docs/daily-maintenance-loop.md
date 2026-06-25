# Passport daily maintenance loop

Copy-pasteable agent prompt for a **daily big-win microadjustment** cycle on frozen, pilot-ready Passport substrate. Ops/docs/tests only — no protocol, schema, route, or signing changes.

Related: [pilot-support-runbook.md](./pilot-support-runbook.md) · [passport-enrollment-ops.md](./passport-enrollment-ops.md)

---

## Scope (hard boundary)

| In scope | Out of scope |
|---|---|
| `passport/` repo only | `3 aaamigas/`, APF product code |
| Docs, comments, env examples, trivial test fixes | Protocol, schema, routes, signing, receipt format |
| `npm test`, optional `check:contract` / `check:env` | Shared Redis rate limiter, health endpoint expansion |
| One additive micro-win per day max | Commits unless the operator explicitly asks |

Cross-links to `3 aaamigas` docs are allowed; do not edit files outside `passport/`.

---

## Copy-paste agent prompt (daily loop body)

Paste everything between the lines below into Cursor chat, `/loop`, or a Cursor Automation.

```text
Passport daily maintenance — frozen substrate, docs-first micro-wins only.

WORKSPACE: continual-harness-main/passport/ ONLY. Do not edit 3 aaamigas or APF code (doc cross-links OK). Do not commit unless I explicitly ask.

NEVER change: protocol, Prisma schema, API routes, signing logic, receipt format, or enrollment/evidence contracts.

---

## Phase A — Quick health (always run)

From passport/:

1. npm test
   - Record raw terminal output (pass/fail counts, failing file names).
   - Baseline from audit: ~425 tests, ~5 intermittent flakes (gate, receipt, angelcoin, logger). Treat new failures as must-fix; flaky-only failures → defer unless trivial fix is obvious.

2. Optional contract probe (skip if no server URL):
   - If BASE_URL or NEXT_PUBLIC_APP_URL is set and reachable, run:
     npm run check:contract -- --base-url <that-url>
   - If no server is running or URL unset, skip and note "contract check skipped — no live server".

3. Optional env sanity (no server required):
   - npm run check:env
   - If it fails only on placeholder keys in .env, note as expected for local dev; do not "fix" by weakening validation.

---

## Phase B — Audit backlog (prioritized checklist)

Work top-down. Skip items already done; document skips in Phase D report.

### B1 — .env.example / PostgreSQL alignment (docs/env only if safe)
- Audit finding: `.env.example` defaults to SQLite + zero-key signing seed; pilots need PostgreSQL + real secrets.
- Safe actions: add/adjust comments in `.env.example`, README, pilot docs pointing to PostgreSQL template in pilot-support-runbook.
- Do NOT change runtime env validation behavior or default DATABASE_URL without explicit approval.

### B2 — pilot-support-runbook callouts
- Ensure operators know: profile 404 before first evidence is expected for unknown commitments; enrollment must complete before evidence.
- Add or tighten callouts only in passport/docs/ — see pilot-support-runbook COMMON_FAILURES and First Incident Triage.

### B3 — Doc drift (SQLite mentions)
- Grep passport/docs and passport/README for SQLite presented as pilot-ready; align wording with "local dev only, PostgreSQL for pilots".
- Do not remove SQLite support from code.

### B4 — Test flake triage (fix only if trivial)
- Suspected areas from audit: gate/*, receipt/*, angelcoin/*, observability/logger tests.
- Allowed: deterministic timers, mock isolation, resetInMemoryRateLimits in beforeEach — if ≤~15 lines and zero behavior change.
- If fix needs route/schema/protocol touch → STOP, defer, report as must-fix blocker.

### B5 — Known deferrals (document, do not implement here)
- Shallow health (`GET /api/health` → `{ status: "ok" }` only) — note in docs if missing; no endpoint expansion.
- In-memory rate limits (no Redis) — document multi-instance caveat only; no shared store work.

---

## Phase C — One micro-win rule

Pick **at most ONE** small additive change today:

Examples (pick one):
- Doc paragraph or table row in passport/docs/
- Comment clarifying pilot vs dev defaults
- `.env.example` comment block (not changing validation)
- Trivial flake fix per B4
- check:env warning text improvement (wording only)

Do NOT stack multiple micro-wins. If nothing safe qualifies, report "no micro-win today" and why.

---

## Phase D — Report format (required output)

Return a structured report:

### Summary
- Date / run id
- Test result: X passed / Y total (paste raw npm test tail if run)
- Contract check: PASS / SKIPPED / FAIL (with raw output if run)
- Micro-win: what changed (file paths) OR "none"

### Changed
- Bullet list of files touched and one-line rationale each

### Skipped
- Backlog items not addressed today and why

### Must-fix vs defer
| Item | Status | Notes |
|------|--------|-------|
| ... | must-fix / defer / done | ... |

### STOP conditions hit?
- List any blockers that forbid substrate changes (see below)

---

## STOP conditions (do not proceed past report)

Stop implementation and escalate in the report if any would require:

- Prisma schema or migration changes
- New or changed API routes or response shapes
- Signing, digest, or enrollment/evidence protocol changes
- Receipt format or public profile field expansion
- Non-trivial test rewrites (>~15 lines or behavior change)
- Dependency upgrades with runtime impact

When stopped: describe the blocker, minimal repro, and recommended founder-level decision — do not patch around it.
```

---

## `/loop` usage (Cursor chat)

The [Loop skill](https://cursor.com) accepts `/loop [interval] <prompt>`. Use a short prompt that points at this doc or inlines Phase A–D.

### Fixed schedule — every 24 hours

```text
/loop 24h Run Passport daily maintenance from passport/docs/daily-maintenance-loop.md — copy-paste agent prompt section. Scope passport/ only. One micro-win max. Report Phase D format. No commits unless I ask.
```

### Fixed schedule — weekdays 9:00 (agent wakes daily; align with your timezone habit)

Cursor cron automations use cron expressions; for chat `/loop`, use 24h on weekdays manually or prefer **Cursor Automation** (below) with `0 9 * * 1-5`.

```text
/loop 24h Weekday Passport maintenance: execute daily-maintenance-loop.md agent prompt. Skip if today is Saturday/Sunday. Phase D report only; no substrate changes.
```

### Dynamic mode (agent picks next delay)

```text
/loop Run Passport daily maintenance from passport/docs/daily-maintenance-loop.md. After each run, if tests are green and backlog has safe doc work, sleep ~24h; if tests failed, suggest re-run in 4h. One micro-win max per run.
```

### Minimal one-liner (paste in chat)

```text
/loop 24h @passport/docs/daily-maintenance-loop.md — run the copy-paste agent prompt; Phase A–D; passport/ only; one micro-win; no protocol/schema/route/signing changes; no commits.
```

---

## PowerShell loop variant (Windows)

For a local terminal ticker (outside Cursor Automations), run from repo root. **Replace the prompt** with your shortened instruction or open the doc in Cursor manually on each tick.

```powershell
# Loop every 24 hours — stop with Ctrl+C
$prompt = "Run Passport daily maintenance from passport/docs/daily-maintenance-loop.md (Phase A-D). passport/ only. One micro-win. No commits."
while ($true) {
    Write-Host "AGENT_LOOP_TICK_passport_maintenance $(Get-Date -Format o) $(ConvertTo-Json @{ prompt = $prompt })"
    Start-Sleep -Seconds 86400
}
```

Weekdays-only variant:

```powershell
$prompt = "Passport daily maintenance — see passport/docs/daily-maintenance-loop.md"
while ($true) {
    if ((Get-Date).DayOfWeek -notin @('Saturday','Sunday')) {
        Write-Host "AGENT_LOOP_TICK_passport_maintenance $(Get-Date -Format o) $(ConvertTo-Json @{ prompt = $prompt })"
    }
    Start-Sleep -Seconds 86400
}
```

Then paste the agent prompt from this doc into Cursor when the sentinel prints (or use Cursor Automation instead for headless scheduling).

---

## Audit backlog reference (2025 pilot freeze)

| Priority | Finding | Daily loop action |
|---|---|---|
| P1 | `.env.example` SQLite + zero-key drift | B1 — comments / doc alignment |
| P1 | Profile 404 before first evidence confuses pilots | B2 — runbook callouts |
| P2 | Doc drift (SQLite as pilot-ready) | B3 — grep and fix docs |
| P2 | ~5 test flakes (420/425 in audit) | B4 — trivial fixes only |
| P3 | Shallow health endpoint | Document only (B5) |
| P3 | In-memory rate limits | Document only (B5) |

---

## Escalation

Substrate changes require founder approval. See [pilot-support-runbook.md — Escalation boundaries](./pilot-support-runbook.md#escalation-boundaries).
