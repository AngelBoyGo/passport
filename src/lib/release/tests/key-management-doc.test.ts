import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const PASSPORT_ROOT = join(__dirname, "../../../..");
const DOC_PATH = join(PASSPORT_ROOT, "docs/key-management.md");

describe("key-management.md", () => {
  it("exists at docs/key-management.md", () => {
    expect(existsSync(DOC_PATH)).toBe(true);
  });

  it("contains required operational sections", () => {
    const doc = readFileSync(DOC_PATH, "utf-8");

    expect(doc, "missing escrow section").toMatch(/escrow/i);
    expect(doc, "missing rotation procedure").toMatch(/rotation/i);
    expect(doc, "missing public-key verification").toMatch(/\/api\/v1\/public-key/);
    expect(doc, "missing blast radius for old receipts").toMatch(
      /blast\s*radius|old\s+receipts/i,
    );
  });

  it("cross-links to DEPLOY.md SIGNING_PRIVATE_KEY and disaster-recovery.md", () => {
    const doc = readFileSync(DOC_PATH, "utf-8");

    expect(doc).toMatch(/DEPLOY\.md/);
    expect(doc).toMatch(/SIGNING_PRIVATE_KEY/);
    expect(doc).toMatch(/disaster-recovery\.md/);
  });

  it("contains no secret values", () => {
    const doc = readFileSync(DOC_PATH, "utf-8");

    expect(doc).not.toMatch(/[0-9a-f]{64}/i);
  });
});
