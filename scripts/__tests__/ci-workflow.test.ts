import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const passportRoot = path.resolve(__dirname, "../..");
const workflowPath = path.join(passportRoot, ".github/workflows/ci.yml");

describe("Passport GitHub Actions CI workflow", () => {
  it("ci.yml exists under passport/.github/workflows/", () => {
    expect(existsSync(workflowPath)).toBe(true);
  });

  it("defines test job with npm ci, prisma validate, and npm test", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toMatch(/^\s*test:/m);
    expect(workflow).toMatch(/npm ci/);
    expect(workflow).toMatch(/prisma validate/);
    expect(workflow).toMatch(/npm test/);
  });
});
