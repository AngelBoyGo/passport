import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { REQUIRED_PROD_ENV } from "@/lib/config/env";

const PASSPORT_ROOT = join(__dirname, "../../../..");
const MANIFEST_PATH = join(PASSPORT_ROOT, "docs/environment-manifest.md");

describe("environment-manifest.md", () => {
  it("exists at docs/environment-manifest.md", () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
  });

  it("documents every REQUIRED_PROD_ENV name with word-boundary match", () => {
    const manifest = readFileSync(MANIFEST_PATH, "utf-8");

    for (const name of REQUIRED_PROD_ENV) {
      const pattern = new RegExp(`\\b${name}\\b`);
      expect(manifest, `missing ${name}`).toMatch(pattern);
    }
  });

  it("documents single-replica pilot constraint", () => {
    const manifest = readFileSync(MANIFEST_PATH, "utf-8");
    expect(manifest).toMatch(/single[- ]replica/i);
    expect(manifest).toMatch(/pilot/i);
  });

  it("lists Railway as primary deployment target without secret values", () => {
    const manifest = readFileSync(MANIFEST_PATH, "utf-8");
    expect(manifest).toMatch(/\bRailway\b/i);
    expect(manifest).not.toMatch(/sk_(test|live)_[a-zA-Z0-9]+/);
    expect(manifest).not.toMatch(/whsec_[a-zA-Z0-9]+/);
    expect(manifest).not.toMatch(/[0-9a-f]{64}/i);
  });

  it("links to railway.json, DEPLOY.md, and docker-compose.verify.yml", () => {
    const manifest = readFileSync(MANIFEST_PATH, "utf-8");
    expect(manifest).toMatch(/railway\.json/);
    expect(manifest).toMatch(/DEPLOY\.md/);
    expect(manifest).toMatch(/docker-compose\.verify\.yml/);
  });

  it("documents passport.metis.gold as production domain target", () => {
    const manifest = readFileSync(MANIFEST_PATH, "utf-8");
    expect(manifest).toMatch(/passport\.metis\.gold/);
  });
});
