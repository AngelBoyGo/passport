/**
 * Backup workflow integrity test (Phase 40).
 *
 * The deploy outage taught the hard lesson: production had NO backups until one was
 * taken manually. This test makes the backup pipeline non-regressable: scheduled runs, dump + restore
 * verification, off-server artifact copy, retention pruning, and a hard ban on shipping
 * the secrets file with backups.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const passportRoot = path.resolve(__dirname, "../..");
const backupWorkflowPath = path.join(passportRoot, ".github/workflows/backup.yml");

const REQUIRED_BACKUP_STEPS: Array<[string, RegExp]> = [
  ["weekly schedule trigger", /\n\s*schedule:/],
  ["cron expression present", /- cron:/],
  ["manual dispatch allowed", /workflow_dispatch/],
  ["uses deploy SSH secrets (server-side dump)", /DEPLOY_SSH_KEY/],
  ["pg_dump custom format (not plain text)", /pg_dump[^\n]*-Fc/],
  ["restore-verification of the dump (pg_restore catalog)", /pg_restore --list/],
  ["artifact upload (off-server copy)", /actions\/upload-artifact/],
  ["artifact retention declared", /retention-days:/],
  ["old backup pruning on the droplet (bounded storage)", /ls -t[^\n]*\| tail -n/],
];

const FORBIDDEN_IN_BACKUP: Array<[string, RegExp]> = [
  ["secrets (.env.production) must never be uploaded as artifact", /env\.production/],
];

function missingSteps(text: string, steps: Array<[string, RegExp]>): string[] {
  return steps.filter(([, re]) => !re.test(text)).map(([label]) => label);
}

describe("Scheduled backup workflow (non-regressable)", () => {
  it("backup.yml exists under .github/workflows/", () => {
    expect(existsSync(backupWorkflowPath)).toBe(true);
  });

  it("runs on a weekly cron + manual dispatch", () => {
    const wf = readFileSync(backupWorkflowPath, "utf8");
    expect(missingSteps(wf, REQUIRED_BACKUP_STEPS.slice(0, 2))).toEqual([]);
  });

  it("dumps the live database in pg_restore-safe format and verifies it restores", () => {
    const wf = readFileSync(backupWorkflowPath, "utf8");
    const missing = missingSteps(wf, REQUIRED_BACKUP_STEPS);
    expect(missing, `backup workflow missing: ${missing.join("; ")}`).toEqual([]);
  });

  it("keeps an off-server copy with declared retention and prunes the droplet copy", () => {
    const wf = readFileSync(backupWorkflowPath, "utf8");
    expect(wf).toMatch(/upload-artifact/);
    expect(wf).toMatch(/retention-days:\s*\d+/);
    expect(wf).toMatch(/passport-\S*\.dump/);
  });

  it("never uploads the secrets file", () => {
    const wf = readFileSync(backupWorkflowPath, "utf8");
    for (const [label, re] of FORBIDDEN_IN_BACKUP) {
      expect(wf, label).not.toMatch(re);
    }
  });
});
