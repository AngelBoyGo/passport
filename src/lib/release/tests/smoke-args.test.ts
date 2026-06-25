import { describe, it, expect } from "vitest";
import {
  buildSmokeWarnings,
  formatSmokeHelp,
  parseSmokeArgs,
} from "@/lib/release/smoke-args";

describe("parseSmokeArgs", () => {
  it("defaults baseUrl to localhost when no args or env", () => {
    const args = parseSmokeArgs([], {});
    expect(args.baseUrl).toBe("http://localhost:3000");
    expect(args.agentHash).toBeUndefined();
    expect(args.receiptId).toBeUndefined();
  });

  it("reads baseUrl from env when CLI flag is absent", () => {
    const args = parseSmokeArgs([], { BASE_URL: "https://passport.example.com/" });
    expect(args.baseUrl).toBe("https://passport.example.com");
  });

  it("prefers CLI flags over env vars", () => {
    const args = parseSmokeArgs(
      ["--base-url", "https://cli.example.com", "--agent-hash", "a".repeat(64), "--receipt-id", "rcpt_abc"],
      {
        BASE_URL: "https://env.example.com",
        AGENT_HASH: "b".repeat(64),
        RECEIPT_ID: "rcpt_env",
      }
    );
    expect(args.baseUrl).toBe("https://cli.example.com");
    expect(args.agentHash).toBe("a".repeat(64));
    expect(args.receiptId).toBe("rcpt_abc");
  });

  it("reads optional hash and receipt from env", () => {
    const hash = "c".repeat(64);
    const args = parseSmokeArgs([], {
      BASE_URL: "http://127.0.0.1:3000",
      AGENT_HASH: hash,
      RECEIPT_ID: "rcpt_test123",
    });
    expect(args.agentHash).toBe(hash);
    expect(args.receiptId).toBe("rcpt_test123");
  });

  it("strips trailing slash from baseUrl", () => {
    const args = parseSmokeArgs(["--base-url", "http://localhost:3000/"], {});
    expect(args.baseUrl).toBe("http://localhost:3000");
  });

  it("detects help flags without requiring probe inputs", () => {
    const args = parseSmokeArgs(["--help"], {});
    expect(args.showHelp).toBe(true);
    expect(args.agentHash).toBeUndefined();
    expect(args.receiptId).toBeUndefined();
  });

  it("keeps optional deep-probe IDs omitted gracefully", () => {
    const args = parseSmokeArgs(["--base-url", "https://staging.example.com"], {});
    expect(args.agentHash).toBeUndefined();
    expect(args.receiptId).toBeUndefined();
  });
});

describe("buildSmokeWarnings", () => {
  it("warns when localhost smoke is pointed at sqlite", () => {
    const warnings = buildSmokeWarnings(
      { baseUrl: "http://localhost:3000" },
      { DATABASE_URL: "file:./dev.db" }
    );

    expect(warnings).toContain(
      "BASE_URL is local while DATABASE_URL uses SQLite/file; this is local/dev-only and does not verify staging/prod rollout."
    );
  });

  it("does not warn for deployed base URL with postgres", () => {
    const warnings = buildSmokeWarnings(
      { baseUrl: "https://passport.example.com" },
      { DATABASE_URL: "postgresql://user:pass@host:5432/db" }
    );

    expect(warnings).toEqual([]);
  });
});

describe("formatSmokeHelp", () => {
  it("shows deployed BASE_URL guidance and examples", () => {
    const help = formatSmokeHelp();

    expect(help).toContain("BASE_URL should target the deployed/staging app");
    expect(help).toContain("BASE_URL=https://passport.example.com npm run smoke:github");
    expect(help).toContain("--agent-hash");
  });
});
