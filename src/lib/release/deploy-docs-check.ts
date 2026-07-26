import { readFileSync } from "node:fs";
import { REQUIRED_PROD_ENV } from "@/lib/config/env";

export type DeployDocsCheckResult = {
  ok: boolean;
  missing: string[];
};

/**
 * Returns missing REQUIRED_PROD_ENV names not found in deploy markdown.
 */
export function checkDeployDocs(deployMarkdown: string): DeployDocsCheckResult {
  const missing = REQUIRED_PROD_ENV.filter(
    (name) => !deployMarkdown.includes(name)
  );
  return { ok: missing.length === 0, missing: [...missing] };
}

/**
 * Loads DEPLOY.md from disk and verifies required env documentation.
 */
export function checkDeployDocsFile(deployPath: string): DeployDocsCheckResult {
  const content = readFileSync(deployPath, "utf8");
  return checkDeployDocs(content);
}
