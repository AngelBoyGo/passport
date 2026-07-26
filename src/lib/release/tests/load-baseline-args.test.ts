import { describe, it, expect } from "vitest";
import {
  DEFAULT_LOAD_BASELINE_ENDPOINTS,
  parseLoadBaselineArgs,
} from "@/lib/release/load-baseline";

describe("parseLoadBaselineArgs", () => {
  it("requires --base-url", () => {
    const parsed = parseLoadBaselineArgs([]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain("--base-url is required");
    }
  });

  it("includes gate verify, profiles GET, and evidence paths by default", () => {
    const parsed = parseLoadBaselineArgs([
      "--base-url",
      "http://localhost:3000",
    ]);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const paths = parsed.endpoints.map((endpoint) => endpoint.path);
    expect(paths.some((path) => path.includes("/api/v1/gate/verify"))).toBe(
      true
    );
    expect(paths.some((path) => path.includes("/api/v1/profiles/"))).toBe(true);
    expect(
      paths.some((path) => path.includes("/api/v1/passport/agents/"))
    ).toBe(true);
    expect(DEFAULT_LOAD_BASELINE_ENDPOINTS.length).toBeGreaterThan(0);
  });

  it("rejects invalid URL", () => {
    const parsed = parseLoadBaselineArgs([
      "--base-url",
      "not-a-valid-url",
    ]);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toMatch(/invalid.*url/i);
    }
  });

  it("parses dry-run without requiring live probes", () => {
    const parsed = parseLoadBaselineArgs([
      "--base-url",
      "http://localhost:3000",
      "--dry-run",
    ]);

    expect(parsed).toEqual({
      ok: true,
      baseUrl: "http://localhost:3000",
      dryRun: true,
      requestsPerEndpoint: 10,
      endpoints: DEFAULT_LOAD_BASELINE_ENDPOINTS,
    });
  });
});
