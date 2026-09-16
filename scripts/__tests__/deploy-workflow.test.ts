/**
 * Deploy workflow integrity test (Phase 40).
 *
 * The first live deploy pulled prisma@7 into the migrate step (schema parse broke), used
 * compose --force-recreate (v1 ContainerConfig crash), and shipped without a post-deploy
 * health gate. This test makes all three failure modes non-regressable.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const passportRoot = path.resolve(__dirname, "../..");
const deployWorkflowPath = path.join(passportRoot, ".github/workflows/deploy.yml");

const REQUIRED_DEPLOY_STEPS: Array<[string, RegExp]> = [
  ["builds the image", /docker build/],
  ["ships the schema+migrations dir to the server", /prisma\/\*\*/],
  ["resolves the pinned Prisma CLI version from package.json", /devDependencies\.prisma\.replace/],
  ["migrates with the PINNED cli (npx prisma@VERSION)", /npx --yes prisma@\$\{\{ env\.PRISMA_VERSION \}\} migrate deploy/],
  ["sources the server-side compose env for the DB password", /source \.env/],
  ["recreates app+caddy via stop/rm/up (v1-safe path)", /docker-compose stop app caddy/],
  ["post-deploy health gate (curl /api/health)", /\/api\/health/],
];

const FORBIDDEN_IN_DEPLOY: Array<[string, RegExp]> = [
  ["compose v1 --force-recreate crashes on newer engines (ContainerConfig)", /--force-recreate/],
];

function missingSteps(text: string, steps: Array<[string, RegExp]>): string[] {
  return steps.filter(([, re]) => !re.test(text)).map(([label]) => label);
}

describe("Deploy workflow (non-regressable)", () => {
  const wf = existsSync(deployWorkflowPath) ? readFileSync(deployWorkflowPath, "utf8") : "";

  it("deploy.yml exists under .github/workflows/", () => {
    expect(existsSync(deployWorkflowPath)).toBe(true);
  });

  it("builds, ships schema, pins the migrate CLI, and gates on post-deploy health", () => {
    const missing = missingSteps(wf, REQUIRED_DEPLOY_STEPS);
    expect(missing, `deploy workflow missing: ${missing.join("; ")}`).toEqual([]);
  });

  it("migrate CLI version is pinned, not floating", () => {
    expect(wf).toMatch(/npx --yes prisma@\$\{\{ env\.PRISMA_VERSION \}\}/);
  });

  it("never uses compose --force-recreate (newer engines crash v1 recreate)", () => {
    for (const [label, re] of FORBIDDEN_IN_DEPLOY) {
      expect(wf, label).not.toMatch(re);
    }
  });

  it("the deploy fails loudly when the app does not go healthy", () => {
    expect(wf).toMatch(/exit 1/);
    expect(wf).toMatch(/docker logs --tail 20 passport_app_1/);
  });

  it("the meta-test itself detects weakening: dropping the pinned migrate step fails the pin check", () => {
    const lines = wf.split("\n");
    const pinLines = lines
      .map((l, i) => (l.includes("npx --yes prisma@") ? i + 1 : 0))
      .filter(Boolean);
    const weakened = lines.filter((_, i) => !pinLines.includes(i + 1)).join("\n");
    const missing = missingSteps(weakened, REQUIRED_DEPLOY_STEPS);
    expect(missing.some((m) => m.startsWith("migrates with the PINNED cli"))).toBe(true);
  });
});
