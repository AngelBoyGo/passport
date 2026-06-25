# Repository security and hosting

Practical guidance for protecting Passport source and ideas while the pilot substrate stays frozen. This doc is ops/legal posture only — no protocol, schema, or code changes.

Related: [branching.md](./branching.md) · [pilot-support-runbook.md](./pilot-support-runbook.md)

---

## What GitHub is used for today

As of the pilot freeze, **`passport/` is a local-only git repository** (initialized in-repo; no configured remote). Git tracks:

- Branch workflow (`main` = frozen substrate; feature branches for docs/tooling)
- Commit history for audit and rollback
- Optional future CI (contract checks, vitest) when a remote is added

If/when you add GitHub (or another host), use it as **private version control + CI**, not as a public idea showcase until you deliberately open-source or share.

---

## Protection checklist (while working)

| Practice | Why |
|----------|-----|
| **Private repository** | Default for unreleased protocol and pilot ops |
| **Branch protection on `main`** | Require PR + passing checks before merge; no direct pushes |
| **No secrets in repo** | Keys, salts, DB URLs, API keys only in `.env` (listed in `.gitignore`) |
| **Review `.gitignore`** | Confirm `.env`, `*.db`, logs, and local artifacts stay untracked |
| **Copyright notice in README** | Establishes ownership; add license when you choose one |
| **Selective sharing** | Share runbooks and integration docs with pilots; keep signing internals and roadmap private until ready |
| **Least-privilege collaborators** | Read vs write access; no shared operator keys in chat |

---

## Self-hosting migration (when ready)

Replace GitHub with your own forge without rewriting git history:

1. **Provision VPS** — small VM with TLS (Caddy/nginx), backups, and SSH hardening.
2. **Install Forgejo or Gitea** — lightweight self-hosted git + PR UI.
3. **Create private repo** — import existing `passport/` history (`git push --mirror` or bundle restore).
4. **Point local remote** — `git remote add origin https://forge.example/passport.git`; push feature branches.
5. **Enable branch protection** — same rules as GitHub: `main` protected, required status checks.
6. **Self-hosted CI runner** — register a runner on the VPS or a separate build host; run `npm test`, `check:contract`, `db:status` on PRs.
7. **Off-site git bundles** — scheduled `git bundle create passport-$(date).bundle --all`; store encrypted off VPS.
8. **Retire GitHub remote** — remove collaborators, archive or delete remote after mirror verified.

No substrate migration is required — only where `git push` and CI run.

---

## Deferred (founder-level, out of scope)

**Logical timestamping / consensus coordination** (e.g. distributed witness networks, hash-chain notarization across untrusted peers) is a **future founder-level** concern. It would touch protocol and trust assumptions on the frozen substrate and is **not implemented** in Passport pilot code.

**AngelCoin** remains a **separate deferred ledger** — not part of this repo’s security or hosting path. See [branching.md](./branching.md) for branch boundaries.
