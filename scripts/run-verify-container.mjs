/**
 * Cross-platform launcher for scripts/verify-container.sh (Git Bash on Windows).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(root, "verify-container.sh");

const bashCandidates =
  process.platform === "win32"
    ? [
        "C:\\Program Files\\Git\\bin\\bash.exe",
        "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
        "bash",
      ]
    : ["bash", "sh"];

const bash = bashCandidates.find(
  (candidate) => candidate.includes(path.sep) && existsSync(candidate)
) ?? bashCandidates.find((candidate) => !candidate.includes(path.sep)) ?? "sh";

const result = spawnSync(bash, [script], {
  stdio: "inherit",
  cwd: path.join(root, ".."),
  shell: false,
});

process.exit(result.status ?? 1);
