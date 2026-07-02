# Passport disaster recovery

Operator runbook for PostgreSQL backup, restore verification, and recovery objectives. This doc is additive ops guidance only — it does not change protocol, schema, routes, or signing.

Related docs:

- [pilot-support-runbook.md](./pilot-support-runbook.md) — day-to-day pilot operations and common failures

---

## Recovery objectives (placeholders)

| Metric | Target (placeholder) | Notes |
|---|---|---|
| **RPO** (Recovery Point Objective) | _TBD by operator_ | Maximum acceptable data loss window between backups |
| **RTO** (Recovery Time Objective) | _TBD by operator_ | Maximum acceptable downtime to restore service |

Confirm RPO/RTO with your hosting provider (e.g. Railway managed Postgres snapshots) and any scheduled `backup:db` cron you deploy.

---

## Prerequisites

- PostgreSQL `DATABASE_URL` with sufficient privileges for `pg_dump`
- `pg_dump` available on the operator machine or CI runner
- Safe backup directory (no path traversal — use `./backups/` under `passport/`)

---

## Backup procedure

From `passport/`:

```powershell
# Validate env and paths without running pg_dump (CI-safe)
npm run backup:db -- --output ./backups/passport-$(Get-Date -Format yyyyMMdd-HHmm).sql --dry-run

# Live backup when DATABASE_URL points at pilot/staging Postgres
$env:DATABASE_URL = "postgresql://passport:<password>@localhost:5432/passport"
npm run backup:db -- --output ./backups/passport-manual.sql
```

Success emits one JSON line on stdout:

```json
{"event":"backup_completed","outcome":"success","output_path":"./backups/passport-manual.sql","database_url_redacted":"postgresql://passport:***@localhost:5432/passport","latency_ms":1234}
```

Failures emit `outcome: "failure"` on stderr with `reason_code: "pg_dump_failed"`.

---

## Restore verification (skeleton)

Before any destructive restore, verify the dump artifact path and follow your verify stack:

```powershell
npm run restore:verify -- --dump-path ./backups/passport-manual.sql --dry-run
```

Expected: JSON line with `event: "restore_verify"` and `RESTORE_VERIFY_DRY_RUN ok`.

### Full restore drill (human-operated)

1. **Stop writes** — scale Passport to zero or enable maintenance mode on the target environment.
2. **Restore database** — use provider console snapshot restore, or `psql` / `pg_restore` against a **non-production** clone first.
3. **Verify stack** — from `passport/`:
   ```powershell
   npm run check:env
   npm run db:status
   npm run doctor:passport
   npm run check:contract -- --base-url http://localhost:3000
   ```
4. **Smoke optional enrollment** — only against a disposable pilot database:
   ```powershell
   npm run smoke:agent-enrollment
   ```
5. **Record drill date** — update your operator log with RPO/RTO observed vs targets.

---

## Blocked (requires human / provider)

| Item | Owner | Status |
|---|---|---|
| Scheduled backup cron (Railway cron, GitHub Actions, or host scheduler) | Operator | Blocked — not automated in-repo |
| Railway console backup / PITR confirmation | Operator | Blocked — verify in provider dashboard |
| Full restore drill execution on staging clone | Operator | Blocked — run manually per steps above |

---

## Incident escalation

If backup or restore fails during an incident:

1. Capture the JSON `backup_completed` or `restore_verify` line from stdout/stderr.
2. Confirm `DATABASE_URL` host reachability and `pg_dump` version compatibility.
3. Fall back to provider-managed snapshots if local `pg_dump` fails.
4. Follow [pilot-support-runbook.md](./pilot-support-runbook.md) triage for application-level checks after DB recovery.
