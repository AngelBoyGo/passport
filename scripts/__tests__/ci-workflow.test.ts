/**
 * CI-integrity meta-test (Phase 39).
 *
 * The CI pipeline IS the quality gate. If a future edit silently drops the type checks,
 * the lint zero-error budget, the test run, or the fresh-DB migrate build, regressions
 * re-enter the repo unnoticed. This test makes each required element fail by name.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/** Warn ceiling tracked in CI docs — must not grow (425-error baseline, Phase 39). */
const MAX_LINT_WARNINGS = 137;

const passportRoot = path.resolve(__dirname, "../..");
const workflowPath = path.join(passportRoot, ".github/workflows/ci.yml");

/** Every step the CI pipeline must contain, as (label, regex) pairs. */
const REQUIRED_VERIFY_STEPS: Array<[string, RegExp]> = [
  ["npm ci (deterministic install)", /npm ci\b/],
  ["prisma generate (client before tsc)", /prisma generate/],
  ["prisma validate (schema)", /prisma validate/],
  ["root typecheck (not the -p sdk variant)", /tsc --noEmit(?!\s+-p)/],
  ["SDK typecheck", /tsc --noEmit[^\n]*-p\s+sdk\/tsconfig\.json/],
  ["eslint zero-error budget", /npx? eslint\s.*\bsrc\b/],
  ["vitest run", /vitest run|npm test\b/],
];

const REQUIRED_BUILD_STEPS: Array<[string, RegExp]> = [
  ["postgres service container", /postgres/],
  ["fresh-DB migrate deploy", /prisma migrate deploy/],
  ["next build", /next build|npm run build/],
];

const REQUIRED_TRIGGERS: Array<[string, RegExp]> = [
  ["push trigger", /push:/],
  ["pull_request trigger", /pull_request:/],
  ["main branch in triggers", /branches:\s*\[[^\]]*main/],
  ["concurrency group to cancel superseded runs", /concurrency:/],
];

/** Returns the labels of required steps missing from the given workflow text. */
export function missingSteps(workflow: string, steps: Array<[string, RegExp]>): string[] {
  return steps.filter(([, re]) => !re.test(workflow)).map(([label]) => label);
}

describe("Passport CI quality gate (non-regressable)", () => {
  it("ci.yml exists under .github/workflows/", () => {
    expect(existsSync(workflowPath)).toBe(true);
  });

  it("verify job runs install, prisma, BOTH typechecks, eslint, and the test suite", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const missing = missingSteps(workflow, REQUIRED_VERIFY_STEPS);
    expect(missing, `CI is missing verify steps: ${missing.join("; ")}`).toEqual([]);
  });

  it("build job proves migrations apply to a fresh Postgres before next build", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const missing = missingSteps(workflow, REQUIRED_BUILD_STEPS);
    expect(missing, `CI build job is missing: ${missing.join("; ")}`).toEqual([]);
  });

  it("runs on push + pull_request to main with concurrency cancellation", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const missing = missingSteps(workflow, REQUIRED_TRIGGERS);
    expect(missing, `CI triggers incomplete: ${missing.join("; ")}`).toEqual([]);
  });

  it("eslint is a hard gate, not continue-on-error", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    // The eslint step must not be wrapped in continue-on-error: true.
    const eslintStep = workflow.match(/[^\n]*eslint[^\n]*\n(?:[^\n]*\n){0,3}?[^\n]*continue-on-error[^\n]*\n?/g) ?? [];
    expect(eslintStep, "eslint step must not use continue-on-error").toEqual([]);
  });

  it(
    "lint budget holds: 0 errors, warnings below the tracked ceiling",
    { timeout: 300_000 },
    async () => {
      // Run the same command CI runs — authoritative single source of truth.
      const out = execFileSync(
        process.platform === "win32" ? "npx.cmd" : "npx",
        ["eslint", "src", "--format", "json"],
        {
          cwd: passportRoot,
          encoding: "utf8",
          timeout: 280_000,
          maxBuffer: 64 * 1024 * 1024,
          shell: process.platform === "win32", // .cmd requires a shell on win32 (Node >= 18.20)
        }
      );
      const results = JSON.parse(out) as Array<{ errorCount: number; warningCount: number }>;
      const errors = results.reduce((n, r) => n + r.errorCount, 0);
      const warnings = results.reduce((n, r) => n + r.warningCount, 0);
      expect(errors, "eslint src must report 0 errors (zero-error budget)").toBe(0);
      expect(
        warnings,
        `warnings must stay <= ${MAX_LINT_WARNINGS}; fix new warnings instead of accumulating`
      ).toBeLessThanOrEqual(MAX_LINT_WARNINGS);
    }
  );

  describe("the meta-test itself detects weakening (self-verification)", () => {
    const base = readFileSync(workflowPath, "utf8");

    function drop(lines: number[]): string {
      return base
        .split("\n")
        .filter((_, i) => !lines.includes(i + 1))
        .join("\n");
    }

    /** Asserts at least one missing step starts with the given prefix. */
    function expectMissing(
      workflowText: string,
      steps: Array<[string, RegExp]>,
      prefix: string
    ) {
      const missing = missingSteps(workflowText, steps);
      expect(
        missing.some((m) => m.startsWith(prefix)),
        `expected a missing step starting with "${prefix}", got: ${missing.join("; ")}`
      ).toBe(true);
    }

    it("fails when the root typecheck step is dropped", () => {
      const tscLines = base
        .split("\n")
        .map((l, i) => (l.includes("tsc --noEmit") && !l.includes("sdk") ? i + 1 : 0))
        .filter(Boolean);
      expectMissing(drop(tscLines), REQUIRED_VERIFY_STEPS, "root typecheck");
    });

    it("fails when the SDK typecheck step is dropped", () => {
      const sdkLines = base
        .split("\n")
        .map((l, i) => (l.includes("sdk/tsconfig.json") ? i + 1 : 0))
        .filter(Boolean);
      expectMissing(drop(sdkLines), REQUIRED_VERIFY_STEPS, "SDK typecheck");
    });

    it("fails when the eslint step is dropped or made continue-on-error", () => {
      const eslintLines = base
        .split("\n")
        .map((l, i) => (/npx? eslint\s.*src/.test(l) ? i + 1 : 0))
        .filter(Boolean);
      expectMissing(drop(eslintLines), REQUIRED_VERIFY_STEPS, "eslint zero-error budget");
    });

    it("fails when the fresh-DB migrate step is dropped", () => {
      const migrateLines = base
        .split("\n")
        .map((l, i) => (l.includes("prisma migrate deploy") ? i + 1 : 0))
        .filter(Boolean);
      expectMissing(drop(migrateLines), REQUIRED_BUILD_STEPS, "fresh-DB migrate deploy");
    });

    it("fails when the test suite step is dropped", () => {
      const testLines = base
        .split("\n")
        .map((l, i) => (/(vitest run|\bnpm test\b)/.test(l) ? i + 1 : 0))
        .filter(Boolean);
      expectMissing(drop(testLines), REQUIRED_VERIFY_STEPS, "vitest run");
    });
  });
});
