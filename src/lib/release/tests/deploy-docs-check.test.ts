import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REQUIRED_PROD_ENV } from "@/lib/config/env";
import { checkDeployDocsFile } from "@/lib/release/deploy-docs-check";

describe("DEPLOY.md documents required production env vars", () => {
  it("lists every REQUIRED_PROD_ENV name in DEPLOY.md", () => {
    const deployPath = resolve(process.cwd(), "DEPLOY.md");
    const content = readFileSync(deployPath, "utf8");

    for (const name of REQUIRED_PROD_ENV) {
      expect(content).toContain(name);
    }
  });

  it("checkDeployDocsFile returns ok when DEPLOY.md is complete", () => {
    const result = checkDeployDocsFile(resolve(process.cwd(), "DEPLOY.md"));
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });
});
