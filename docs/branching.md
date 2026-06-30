# Passport branching and release workflow

Protection-oriented Git workflow for Passport changes during the **pilot-frozen substrate** period. This doc is additive ops guidance only — it does not change protocol, schema, routes, signing, or receipt format.

Related: [daily-maintenance-loop.md](./daily-maintenance-loop.md) · [pilot-support-runbook.md](./pilot-support-runbook.md) · [passport-enrollment-ops.md](./passport-enrollment-ops.md)

---

## Pilot substrate branches

| Branch | Role |
|--------|------|
| **`dev`** | Frozen pilot substrate baseline (enrollment, evidence, receipts, forensics docs). New capability work branches from here. |
| **`feature/*`** | Additive capabilities (e.g. `feature/passport-agent-photo-v1`) branched from `dev`. Merge to `main` only after review. |
| **`main`** | Production-aligned; receives reviewed merges from `dev` / feature branches. |

```bash
git checkout dev
git pull origin dev   # when remote exists
git checkout -b feature/<short-description>
```

The **`dev`** tip includes forensics/read-only tooling (`verify:receipt`) and ops docs; it does not include in-flight feature work until merged.

---

## Frozen substrate boundary (hard rule)

Do **not** merge changes that touch any of the following without explicit founder/engineering approval:

| Category | Examples |
|----------|----------|
| **Protocol** | Receipt payload shape, verification semantics, chain linking rules |
| **Schema** | Prisma models, migrations that alter enrollment/evidence/receipt tables |
| **Routes** | New or changed API paths under `/api/v1/` (including AngelCoin) |
| **Signing** | `SIGNING_PRIVATE_KEY` handling, ed25519 signer/verifier logic |
| **Enrollment / evidence contracts** | Enrollment challenge/response, evidence binding, bridge predicates |

**In scope without approval:** docs, comments, env examples, smoke/contract scripts that only *probe* existing routes, trivial deterministic test fixes (≤~15 lines, zero behavior change).

Before opening a PR, run from `passport/`:

```bash
npm test
npm run check:env          # staging/prod modes
npm run check:contract -- --base-url <deployed-url>   # when a server is reachable
```

---

## Branch naming

| Prefix | Use |
|--------|-----|
| `feature/` | New capability, docs bundles, review branches |
| `fix/` | Bug fixes (must still respect frozen boundary) |
| `docs/` | Documentation-only changes |
| `ops/` | Runbooks, smoke scripts, CI templates (no runtime behavior) |

Examples:

- `feature/passport-branching-and-angelcoin-review`
- `feature/passport-action-primary-forensics` — docs + read-only `verify:receipt` CLI (merged into `dev` baseline)
- `feature/passport-agent-photo-v1` — signed external photo reference (branched from `dev`)
- `docs/pilot-support-runbook-clarity`
- `fix/flaky-angelcoin-rate-limit-test`

**Never commit directly to `main`** during pilot freeze. Use short-lived feature branches and squash or merge via PR.

---

## Standard workflow

1. **Sync main** (when remote exists):
   ```bash
   git checkout main
   git pull origin main
   ```

2. **Create a feature branch:**
   ```bash
   git checkout -b feature/<short-description>
   ```

3. **Make changes** — stay within frozen boundary unless approved.

4. **Verify locally:**
   ```bash
   npm test
   npm run check:env
   # optional, requires running server:
   npm run check:contract -- --base-url http://localhost:3000
   ```

5. **Commit** with a message focused on *why* (not a file list).

6. **Push and open PR:**
   ```bash
   git push -u origin HEAD
   gh pr create --base main --fill
   ```

7. **Merge only after** PR checklist (see `.github/pull_request_template.md`) and reviewer sign-off.

---

## PR checklist (summary)

Full checklist lives in [`.github/pull_request_template.md`](../.github/pull_request_template.md). Highlights:

- [ ] Confirms **no** protocol / schema / route / signing changes (or links approval issue)
- [ ] `npm test` passes
- [ ] `npm run check:env` passes for target environment
- [ ] `npm run check:contract` run against staging when enrollment/evidence touched
- [ ] AngelCoin-only ops: `npm run smoke:angelcoin` when deploying credit ledger
- [ ] Docs updated if operator steps change

---

## Baseline tag: `passport-pilot-ready-v1`

Use an annotated tag to mark the pilot-ready substrate baseline (enrollment + evidence + receipts; AngelCoin code may exist but initiation is a separate ops decision).

**Do not create this tag until:**

- `main` reflects the agreed pilot-ready commit
- Migrations are applied on staging/production
- `check:env`, `doctor:passport`, `db:status`, and `check:contract` pass against the deployment

**Commands (run from `passport/` on the approved commit):**

```bash
# Inspect the commit you intend to tag
git log -1 --oneline

# Create an annotated tag (preferred — includes message + tagger metadata)
git tag -a passport-pilot-ready-v1 -m "Passport pilot-ready substrate baseline (enrollment, evidence, receipts)"

# Verify locally
git tag -l 'passport-pilot-ready-v*'
git show passport-pilot-ready-v1

# Push tag to remote (only when remote exists and team agrees)
git push origin passport-pilot-ready-v1
```

**Rollback reference:** checkout the tag to inspect baseline code (detached HEAD):

```bash
git checkout passport-pilot-ready-v1
```

To return to branch work: `git checkout main`.

---

## GitHub branch protection (manual — GitHub UI)

Branch protection cannot be enabled from this repo alone. Configure in **GitHub → Settings → Branches → Branch protection rules** for `main`:

1. **Require a pull request before merging**
   - Require at least 1 approval (2 for substrate changes if policy requires)
   - Dismiss stale approvals when new commits are pushed

2. **Require status checks to pass** (when CI exists)
   - e.g. `npm test`, contract smoke workflow

3. **Require branches to be up to date before merging**

4. **Do not allow bypassing the above settings** (except designated admins)

5. **Restrict who can push to matching branches** — limit direct pushes to `main`

6. **Optional:** require signed commits; block force pushes

Document the rule URL in your team runbook after creation.

---

## AngelCoin and frozen substrate

AngelCoin routes and schema are **already in the codebase**. **Initiating** AngelCoin (migrate deploy, provision API key, grant credits, run smoke) is an **operational** action and does not require new merges if no code changes are needed.

Any PR that adds AngelCoin routes, changes ledger semantics, or alters enrollment gating for credits **does** require explicit approval. See [passport-angelcoin-proof-packet.md](./passport-angelcoin-proof-packet.md) for architecture reference.

---

## Quick reference

| Task | Command |
|------|---------|
| Tests | `npm test` |
| Env preflight | `npm run check:env` |
| Deployment contract | `npm run check:contract -- --base-url <url>` |
| Forensic receipt verify | `npm run verify:receipt -- --payload <file-or-json> [--signature …] [--public-key …]` |
| AngelCoin smoke | `PASSPORT_API_KEY=… SUBJECT_COMMITMENT=<64-hex> npm run smoke:angelcoin` |
| Migration status | `npm run db:status` |
| Apply migrations (staging/prod) | `npx prisma migrate deploy` |
