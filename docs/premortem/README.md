# Passport Premortem

Use two separate checks: repository release hygiene and application-specific
failure analysis. Neither is a custody audit, financial certification, legal
opinion, or verification of production deployment.

## Local Audit

Selected from https://github.com/topics/premortem:
[Agoragentic Premortem Golden Loop](https://github.com/rhein1/agoragentic-premortem-golden-loop).
Reviewed revision: `774a4163186f04ff45a3db62fc0d3418a5dafa4c` (package version `0.1.7`).
It is a dependency-free Node CLI. No package installation or lifecycle scripts
are needed. Obtain a separate checkout and check out that exact revision; do not
use an unreviewed `npx ...@latest` on this credential-bearing worktree.

```powershell
npm run premortem -- "C:\Users\izzyb\AppData\Local\Temp\opencode\passport-premortem-tool"
npm run premortem:monetary
```

The first command requires Node, Git and `tar` on PATH. It verifies the external
checkout revision and cleanliness, exports this repo's committed `HEAD`, runs
`doctor` and `audit --skip-network --ci`, and keeps the snapshot and reports under
the ignored `.agoragentic/premortem-*/` directory. Each run has a separate report
directory and a `passport-run.json` provenance record. No closure comparison
between runs is implied. Retained snapshots may contain sensitive committed
material; do not publish them or raw reports without review.

The upstream scanner does not honor `.gitignore`. Exporting `HEAD` excludes
untracked and ignored local credentials, but cannot remove a secret already
committed to Git. Secret-pattern findings show locations, not values. The audit
does not cover Git history. Keyword/file-presence checks are heuristic and may
produce false positives or miss real issues. Its discovery scan is capped at
2,500 files and its combined text scan at 300 candidate files.

No application tests, network canaries, paid calls, automatic fixes, migrations,
deployment or production probes are enabled by the wrapper. A nonzero exit
means the upstream readiness gate failed. An exit of zero is not Stage 1 approval.
Uncommitted work is deliberately excluded; record separate tests/review for it.

The second command runs the current working-tree `revalue()` with three synthetic
reserve scenarios. It exits nonzero when aggregate quoted redemption value exceeds
the input reserve. This exposes a missing necessary solvency condition, not actual
customer losses. Do not simply cap or change prices in production: the product's
redemption contract, units and treatment of existing balances need an explicit
decision and migration plan first.

## Decision Record

See [the evidence-backed assessment](stage1-evidence-review-2026-09-05.md) for
findings, verification results, mitigations and go/no-go gates.

The prior `sahel-resource-haven-stage1.md` is preserved as an unverified scenario
draft, not an implementation record or launch authorization. Its claims of
unspoofable hardware, guaranteed compliance and automatic loss coverage are not
established. Do not implement its hazardous physical defenses or automatic
punishment proposals. Security controls must protect personnel and preserve
lawful access, human review and appeal.
