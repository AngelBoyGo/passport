import { describe, it, expect } from "vitest";
import {
  assertAngelcoinSmokeInputs,
  formatAngelcoinSmokeHelp,
  parseAngelcoinSmokeArgs,
} from "@/lib/release/angelcoin-smoke-args";

describe("parseAngelcoinSmokeArgs", () => {
  it("defaults baseUrl to localhost when no args or env", () => {
    const args = parseAngelcoinSmokeArgs([], {});
    expect(args.baseUrl).toBe("http://localhost:3000");
    expect(args.apiKey).toBeUndefined();
    expect(args.subjectCommitment).toBeUndefined();
  });

  it("reads baseUrl from env when CLI flag is absent", () => {
    const args = parseAngelcoinSmokeArgs([], {
      BASE_URL: "https://passport.example.com/",
    });
    expect(args.baseUrl).toBe("https://passport.example.com");
  });

  it("prefers CLI flags over env vars", () => {
    const commitment = "b".repeat(64);
    const args = parseAngelcoinSmokeArgs(
      [
        "--base-url",
        "https://cli.example.com",
        "--api-key",
        "pp_cli_key",
        "--subject-commitment",
        commitment,
      ],
      {
        BASE_URL: "https://env.example.com",
        PASSPORT_API_KEY: "pp_env_key",
        SUBJECT_COMMITMENT: "c".repeat(64),
      }
    );
    expect(args.baseUrl).toBe("https://cli.example.com");
    expect(args.apiKey).toBe("pp_cli_key");
    expect(args.subjectCommitment).toBe(commitment);
  });

  it("reads api key and commitment from env", () => {
    const commitment = "d".repeat(64);
    const args = parseAngelcoinSmokeArgs([], {
      BASE_URL: "http://127.0.0.1:3000",
      PASSPORT_API_KEY: "pp_env_key",
      SUBJECT_COMMITMENT: commitment,
    });
    expect(args.apiKey).toBe("pp_env_key");
    expect(args.subjectCommitment).toBe(commitment);
  });

  it("strips trailing slash from baseUrl", () => {
    const args = parseAngelcoinSmokeArgs(
      ["--base-url", "http://localhost:3000/"],
      {}
    );
    expect(args.baseUrl).toBe("http://localhost:3000");
  });

  it("detects help flags", () => {
    const args = parseAngelcoinSmokeArgs(["--help"], {});
    expect(args.showHelp).toBe(true);
  });
});

describe("assertAngelcoinSmokeInputs", () => {
  it("throws when api key is missing", () => {
    expect(() =>
      assertAngelcoinSmokeInputs({
        baseUrl: "http://localhost:3000",
        subjectCommitment: "e".repeat(64),
      })
    ).toThrow(/PASSPORT_API_KEY/i);
  });

  it("throws when subject commitment is not 64-hex", () => {
    expect(() =>
      assertAngelcoinSmokeInputs({
        baseUrl: "http://localhost:3000",
        apiKey: "pp_test_key",
        subjectCommitment: "not-valid",
      })
    ).toThrow(/64-character hex/i);
  });

  it("accepts valid inputs", () => {
    expect(() =>
      assertAngelcoinSmokeInputs({
        baseUrl: "http://localhost:3000",
        apiKey: "pp_test_key",
        subjectCommitment: "f".repeat(64),
      })
    ).not.toThrow();
  });
});

describe("formatAngelcoinSmokeHelp", () => {
  it("documents smoke command and required env vars", () => {
    const help = formatAngelcoinSmokeHelp();
    expect(help).toContain("smoke:angelcoin");
    expect(help).toContain("PASSPORT_API_KEY");
    expect(help).toContain("SUBJECT_COMMITMENT");
  });
});
