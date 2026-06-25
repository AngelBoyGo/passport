import { describe, it, expect } from "vitest";
import {
  assertEnrollmentSmokeInputs,
  formatEnrollmentSmokeError,
  formatEnrollmentSmokeHelp,
  parseEnrollmentSmokeArgs,
} from "@/lib/release/enrollment-smoke-args";
import { createEnrollmentSmokePrivateKeyHex } from "@/lib/release/enrollment-smoke-key";
import { createEnrollmentSmokePayload } from "@/lib/release/enrollment-smoke-payload";

describe("parseEnrollmentSmokeArgs", () => {
  it("defaults baseUrl to localhost when no args or env", () => {
    const args = parseEnrollmentSmokeArgs([], {});
    expect(args.baseUrl).toBe("http://localhost:3000");
    expect(args.showHelp).toBe(false);
  });

  it("reads baseUrl from env when CLI flag is absent", () => {
    const args = parseEnrollmentSmokeArgs([], {
      BASE_URL: "https://passport.example.com/",
    });
    expect(args.baseUrl).toBe("https://passport.example.com");
  });

  it("prefers CLI flags over env vars", () => {
    const args = parseEnrollmentSmokeArgs(
      ["--base-url", "https://cli.example.com"],
      { BASE_URL: "https://env.example.com" }
    );
    expect(args.baseUrl).toBe("https://cli.example.com");
  });

  it("detects help flag", () => {
    const args = parseEnrollmentSmokeArgs(["--help"], {});
    expect(args.showHelp).toBe(true);
  });
});

describe("assertEnrollmentSmokeInputs", () => {
  it("returns validated inputs", () => {
    const inputs = assertEnrollmentSmokeInputs({
      baseUrl: "https://passport.example.com",
    });
    expect(inputs.baseUrl).toBe("https://passport.example.com");
  });

  it("throws on empty baseUrl", () => {
    expect(() =>
      assertEnrollmentSmokeInputs({ baseUrl: "   " })
    ).toThrow(/BASE_URL must be non-empty/);
  });
});

describe("createEnrollmentSmokePrivateKeyHex", () => {
  it("returns a fresh 32-byte private key hex value for each smoke run", () => {
    const first = createEnrollmentSmokePrivateKeyHex();
    const second = createEnrollmentSmokePrivateKeyHex();

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
  });
});

describe("createEnrollmentSmokePayload", () => {
  it("uses a unique compliance report id for each smoke run", () => {
    const first = createEnrollmentSmokePayload();
    const second = createEnrollmentSmokePayload();

    expect(first.report.id).toMatch(/^smoke-report-/);
    expect(second.report.id).toMatch(/^smoke-report-/);
    expect(first.report.id).not.toBe(second.report.id);
  });
});

describe("formatEnrollmentSmokeHelp", () => {
  it("includes enrollment endpoints", () => {
    const help = formatEnrollmentSmokeHelp();
    expect(help).toContain("enroll/start");
    expect(help).toContain("enrollment_status ENROLLED");
  });
});

describe("formatEnrollmentSmokeError", () => {
  it("points local reachability failures to the direct dev path", () => {
    const error = new TypeError("fetch failed");
    const formatted = formatEnrollmentSmokeError(
      error,
      "http://localhost:3000"
    );

    expect(formatted).toContain("could not reach Passport");
    expect(formatted).toContain("npm run check:env");
    expect(formatted).toContain("npm run db:status");
    expect(formatted).toContain("npm run dev");
    expect(formatted).toContain("curl http://localhost:3000/api/health");
  });

  it("points request timeouts to the direct dev path", () => {
    const error = new Error("This operation was aborted");
    error.name = "AbortError";

    const formatted = formatEnrollmentSmokeError(
      error,
      "http://localhost:3000"
    );

    expect(formatted).toContain("could not reach Passport");
    expect(formatted).toContain("npm run check:env");
    expect(formatted).toContain("npm run db:status");
    expect(formatted).toContain("npm run dev");
  });
});
