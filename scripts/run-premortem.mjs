import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const reviewedRevision = "774a4163186f04ff45a3db62fc0d3418a5dafa4c";
const root = fileURLToPath(new URL("../", import.meta.url));
const tool = process.argv[2];
if (!tool || process.argv.length !== 3) {
  throw new Error("Usage: npm run premortem -- <path-to-reviewed-tool-checkout>; see docs/premortem/README.md");
}
const toolRoot = path.resolve(tool);
const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
if (git(["rev-parse", "HEAD"], toolRoot) !== reviewedRevision ||
    git(["status", "--porcelain", "--untracked-files=all"], toolRoot)) {
  throw new Error(`Tool must be a clean checkout of ${reviewedRevision}. Review changes before updating the pin.`);
}

// The upstream walker ignores neither .env nor .gitignore. Audit committed
// source only; never hand it this worktree's local credentials or build output.
const revision = git(["rev-parse", "HEAD"], root);
const outputRoot = path.join(root, ".agoragentic");
mkdirSync(outputRoot, { recursive: true });
const runRoot = mkdtempSync(path.join(outputRoot, "premortem-"));
const snapshot = path.join(runRoot, "snapshot");
const out = path.join(runRoot, "report");
mkdirSync(snapshot);
mkdirSync(out);
const archive = path.join(runRoot, "source.tar");
execFileSync("git", ["archive", "--format=tar", "--output", archive, revision], { cwd: root });
const extraction = spawnSync("tar", ["-xf", archive, "-C", snapshot]);
if (extraction.error) throw extraction.error;
if (extraction.status !== 0) throw new Error(`Snapshot extraction failed: ${extraction.stderr}`);

const cli = path.join(toolRoot, "bin", "agoragentic-premortem-golden-loop.mjs");
console.log(`Auditing committed HEAD ${revision}; uncommitted changes are excluded.`);
console.log(`Local artifacts: ${out}`);
let exitCode = 0;
for (const command of ["doctor", "audit"]) {
  const args = [cli, command, "--repo", snapshot, "--out", out, "--skip-network", "--ci"];
  if (command === "audit") args.push(
    "--plan", "Assess Passport before a gold-only, read-only physical reserve pilot; no minting, redemption or production deployment",
    "--audience", "Passport maintainers, independent custodians, assayers and compliance reviewers",
    "--success", "Identify evidenced blockers and require reconciled liabilities, independent custody and lawful redemption before real-value launch",
  );
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  exitCode = Math.max(exitCode, result.status ?? 1);
}
writeFileSync(path.join(out, "passport-run.json"), JSON.stringify({
  repository_revision: revision,
  tool_repository: "https://github.com/rhein1/agoragentic-premortem-golden-loop",
  tool_revision: reviewedRevision,
  scope: "committed HEAD only; not worktree or production",
  network_canaries: false,
  application_tests_run_by_tool: false,
  safe_fixes_applied: false,
  exit_code: exitCode,
}, null, 2) + "\n");
process.exitCode = exitCode;
