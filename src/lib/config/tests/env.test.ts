import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  validateEnv,
  getEnvReport,
  REQUIRED_PROD_ENV,
  assertDatabaseUrlMatchesProvider,
} from "@/lib/config/env";

const SECRET_VALUES = {
  DATABASE_URL: "postgresql://user:secret@host/db",
  SIGNING_PRIVATE_KEY: "deadbeef".repeat(8),
  INGESTION_COMMITMENT_SALT: "super-secret-salt-value",
  SESSION_SECRET: "test-session-secret-hex-value",
  STRIPE_SECRET_KEY: "sk_live_super_secret",
  STRIPE_WEBHOOK_SECRET: "whsec_super_secret",
  STRIPE_PRICE_PRO: "price_super_secret",
  NEXT_PUBLIC_APP_URL: "https://passport.example.com",
};

/** Mutable reference for test env manipulation. */
function env(): Record<string, string | undefined> {
  return process.env as Record<string, string | undefined>;
}

describe("validateEnv", () => {
  beforeEach(() => {
    delete env().NODE_ENV;
    delete env().VITEST;
  });

  afterEach(() => {
    delete env().NODE_ENV;
    delete env().VITEST;
  });

  it("throws in production when required vars are missing and names all missing vars without secret values", () => {
    env().NODE_ENV = "production";
    for (const name of REQUIRED_PROD_ENV) {
      delete env()[name];
    }
    env().SIGNING_PRIVATE_KEY = SECRET_VALUES.SIGNING_PRIVATE_KEY;

    let thrown: Error | undefined;
    try {
      validateEnv({ mode: "production" });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain("DATABASE_URL");
    expect(thrown!.message).toContain("INGESTION_COMMITMENT_SALT");
    for (const secret of Object.values(SECRET_VALUES)) {
      expect(thrown!.message).not.toContain(secret);
    }
  });

  it("returns ok when all required vars are present in production", () => {
    env().NODE_ENV = "production";
    env().DATABASE_URL = SECRET_VALUES.DATABASE_URL;
    env().SIGNING_PRIVATE_KEY = SECRET_VALUES.SIGNING_PRIVATE_KEY;
    env().INGESTION_COMMITMENT_SALT =
      SECRET_VALUES.INGESTION_COMMITMENT_SALT;
    env().SESSION_SECRET = SECRET_VALUES.SESSION_SECRET;

    const result = validateEnv({ mode: "production" });
    expect(result.ok).toBe(true);
    expect(result.missingRequired).toEqual([]);
  });

  it("allows missing optional vars with warnings in development", () => {
    env().NODE_ENV = "development";
    env().DATABASE_URL = SECRET_VALUES.DATABASE_URL;
    env().SIGNING_PRIVATE_KEY = SECRET_VALUES.SIGNING_PRIVATE_KEY;
    env().INGESTION_COMMITMENT_SALT =
      SECRET_VALUES.INGESTION_COMMITMENT_SALT;
    env().SESSION_SECRET = SECRET_VALUES.SESSION_SECRET;
    delete env().EVIDENCE_BRIDGE_OPERATOR_ID;
    delete env().EVIDENCE_ENFORCEMENT_ENABLED;
    delete env().NEXT_PUBLIC_APP_URL;

    const result = validateEnv({ mode: "development" });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes("EVIDENCE_BRIDGE_OPERATOR_ID"))).toBe(
      true
    );
  });

  it("skips enforcement in test mode", () => {
    env().NODE_ENV = "test";
    delete env().DATABASE_URL;
    delete env().SIGNING_PRIVATE_KEY;
    delete env().INGESTION_COMMITMENT_SALT;

    const result = validateEnv({ mode: "test" });
    expect(result.ok).toBe(true);
    expect(result.missingRequired).toEqual([]);
  });

  it("skips enforcement when VITEST=true", () => {
    env().VITEST = "true";
    delete env().DATABASE_URL;

    const result = validateEnv({ mode: "production" });
    expect(result.ok).toBe(true);
  });

  it("requires Stripe conditional group when STRIPE_SECRET_KEY is set", () => {
    env().NODE_ENV = "production";
    env().DATABASE_URL = SECRET_VALUES.DATABASE_URL;
    env().SIGNING_PRIVATE_KEY = SECRET_VALUES.SIGNING_PRIVATE_KEY;
    env().INGESTION_COMMITMENT_SALT =
      SECRET_VALUES.INGESTION_COMMITMENT_SALT;
    env().STRIPE_SECRET_KEY = SECRET_VALUES.STRIPE_SECRET_KEY;
    delete env().STRIPE_WEBHOOK_SECRET;
    delete env().STRIPE_PRICE_PRO;
    delete env().NEXT_PUBLIC_APP_URL;

    let thrown: Error | undefined;
    try {
      validateEnv({ mode: "production" });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain("STRIPE_WEBHOOK_SECRET");
    expect(thrown!.message).toContain("STRIPE_PRICE_PRO");
    expect(thrown!.message).toContain("NEXT_PUBLIC_APP_URL");
    expect(thrown!.message).not.toContain(SECRET_VALUES.STRIPE_SECRET_KEY);
  });

  it("passes Stripe conditional group when all Stripe vars are set", () => {
    env().NODE_ENV = "production";
    env().DATABASE_URL = SECRET_VALUES.DATABASE_URL;
    env().SIGNING_PRIVATE_KEY = SECRET_VALUES.SIGNING_PRIVATE_KEY;
    env().INGESTION_COMMITMENT_SALT =
      SECRET_VALUES.INGESTION_COMMITMENT_SALT;
    env().SESSION_SECRET = SECRET_VALUES.SESSION_SECRET;
    env().STRIPE_SECRET_KEY = SECRET_VALUES.STRIPE_SECRET_KEY;
    env().STRIPE_WEBHOOK_SECRET = SECRET_VALUES.STRIPE_WEBHOOK_SECRET;
    env().STRIPE_PRICE_PRO = SECRET_VALUES.STRIPE_PRICE_PRO;
    env().NEXT_PUBLIC_APP_URL = SECRET_VALUES.NEXT_PUBLIC_APP_URL;

    const result = validateEnv({ mode: "production" });
    expect(result.ok).toBe(true);
    expect(result.enabledFlags.stripeConfigured).toBe(true);
  });
});

describe("assertDatabaseUrlMatchesProvider", () => {
  beforeEach(() => {
    delete env().VITEST;
  });

  afterEach(() => {
    delete env().VITEST;
  });

  it("rejects file: URLs when provider is postgresql", () => {
    expect(() =>
      assertDatabaseUrlMatchesProvider("file:./dev.db", "postgresql")
    ).toThrow(/file:|sqlite|postgresql/i);
  });

  it("accepts postgresql:// URLs when provider is postgresql", () => {
    expect(() =>
      assertDatabaseUrlMatchesProvider(
        "postgresql://passport:passport@localhost:5433/passport?schema=public",
        "postgresql"
      )
    ).not.toThrow();
  });

  it(".env.example DATABASE_URL matches postgresql provider", () => {
    const examplePath = resolve(process.cwd(), ".env.example");
    const content = readFileSync(examplePath, "utf8");
    const match = content.match(/^DATABASE_URL=(.+)$/m);
    expect(match).toBeTruthy();
    let value = match![1].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    expect(() =>
      assertDatabaseUrlMatchesProvider(value, "postgresql")
    ).not.toThrow();
    expect(content).not.toMatch(/SQLite|file:\/\//i);
  });

  it("allows sqlite file URLs in development", () => {
    env().NODE_ENV = "development";
    env().DATABASE_URL = "file:./dev.db";
    expect(() => assertDatabaseUrlMatchesProvider()).not.toThrow();
  });

  it("throws in production when DATABASE_URL is sqlite", () => {
    env().NODE_ENV = "production";
    env().DATABASE_URL = "file:./dev.db";

    expect(() => assertDatabaseUrlMatchesProvider()).toThrow(
      /PostgreSQL/i
    );
  });

  it("passes in production when DATABASE_URL is postgresql", () => {
    env().NODE_ENV = "production";
    env().DATABASE_URL = SECRET_VALUES.DATABASE_URL;
    expect(() => assertDatabaseUrlMatchesProvider()).not.toThrow();
  });

  it("skips enforcement in test mode", () => {
    env().NODE_ENV = "test";
    env().DATABASE_URL = "file:./dev.db";
    expect(() => assertDatabaseUrlMatchesProvider()).not.toThrow();
  });
});

describe("getEnvReport", () => {
  it("returns presence booleans without secret values", () => {
    env().DATABASE_URL = SECRET_VALUES.DATABASE_URL;
    env().EVIDENCE_ENFORCEMENT_ENABLED = "true";

    const report = getEnvReport();
    expect(report.presence.DATABASE_URL).toBe(true);
    expect(report.enabledFlags.evidenceEnforcement).toBe(true);
    expect(JSON.stringify(report)).not.toContain(SECRET_VALUES.DATABASE_URL);
  });
});
