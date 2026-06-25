import { describe, it, expect } from "vitest";
import {
  PUBLIC_EVIDENCE_MINTER_STRIPE_CUSTOMER_ID,
  PUBLIC_EVIDENCE_MINTER_EMAIL,
  buildEvidenceMinterUpsert,
  formatSeedMinterHelp,
  parseSeedMinterArgs,
  requireDatabaseUrl,
} from "@/lib/release/seed-minter-args";

describe("parseSeedMinterArgs", () => {
  it("defaults stripeCustomerId to the fixed public minter id", () => {
    const args = parseSeedMinterArgs([], {
      DATABASE_URL: "postgresql://localhost/passport",
    });
    expect(args.stripeCustomerId).toBe(PUBLIC_EVIDENCE_MINTER_STRIPE_CUSTOMER_ID);
    expect(args.dryRun).toBe(false);
    expect(args.showHelp).toBe(false);
  });

  it("reads databaseUrl from env when CLI flag is absent", () => {
    const args = parseSeedMinterArgs([], {
      DATABASE_URL: "postgresql://user:pass@host:5432/db",
    });
    expect(args.databaseUrl).toBe("postgresql://user:pass@host:5432/db");
  });

  it("prefers CLI flags over env vars", () => {
    const args = parseSeedMinterArgs(
      [
        "--database-url",
        "postgresql://cli/db",
        "--stripe-customer-id",
        "cus_custom_minter",
        "--dry-run",
      ],
      {
        DATABASE_URL: "postgresql://env/db",
        PUBLIC_EVIDENCE_MINTER_STRIPE_CUSTOMER_ID: "cus_env_minter",
      }
    );
    expect(args.databaseUrl).toBe("postgresql://cli/db");
    expect(args.stripeCustomerId).toBe("cus_custom_minter");
    expect(args.dryRun).toBe(true);
  });

  it("detects help flags", () => {
    const args = parseSeedMinterArgs(["--help"], {});
    expect(args.showHelp).toBe(true);
  });
});

describe("requireDatabaseUrl", () => {
  it("throws when DATABASE_URL is missing", () => {
    expect(() => requireDatabaseUrl({})).toThrow(
      "Missing required env var: DATABASE_URL"
    );
  });

  it("returns trimmed DATABASE_URL", () => {
    expect(
      requireDatabaseUrl({ DATABASE_URL: "  postgresql://localhost/db  " })
    ).toBe("postgresql://localhost/db");
  });
});

describe("buildEvidenceMinterUpsert", () => {
  it("builds idempotent upsert with service tier and zero credits", () => {
    const upsert = buildEvidenceMinterUpsert(PUBLIC_EVIDENCE_MINTER_STRIPE_CUSTOMER_ID);
    expect(upsert.where).toEqual({
      stripeCustomerId: PUBLIC_EVIDENCE_MINTER_STRIPE_CUSTOMER_ID,
    });
    expect(upsert.create).toMatchObject({
      stripeCustomerId: PUBLIC_EVIDENCE_MINTER_STRIPE_CUSTOMER_ID,
      email: PUBLIC_EVIDENCE_MINTER_EMAIL,
      tier: "service",
      credits: 0,
    });
    expect(upsert.update).toEqual({});
  });
});

describe("formatSeedMinterHelp", () => {
  it("documents the seed command and default stripe customer id", () => {
    const help = formatSeedMinterHelp();
    expect(help).toContain("seed:evidence-minter");
    expect(help).toContain(PUBLIC_EVIDENCE_MINTER_STRIPE_CUSTOMER_ID);
    expect(help).toContain("EVIDENCE_BRIDGE_OPERATOR_ID");
  });
});
