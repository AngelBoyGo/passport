import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  validateEnv,
  getEnvReport,
  REQUIRED_PROD_ENV,
} from "@/lib/config/env";

const SECRET_VALUES = {
  DATABASE_URL: "postgresql://user:secret@host/db",
  SIGNING_PRIVATE_KEY: "deadbeef".repeat(8),
  INGESTION_COMMITMENT_SALT: "super-secret-salt-value",
  STRIPE_SECRET_KEY: "sk_live_super_secret",
  STRIPE_WEBHOOK_SECRET: "whsec_super_secret",
  STRIPE_PRICE_PRO: "price_super_secret",
  NEXT_PUBLIC_APP_URL: "https://passport.example.com",
};

describe("validateEnv", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NODE_ENV;
    delete process.env.VITEST;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws in production when required vars are missing and names all missing vars without secret values", () => {
    process.env.NODE_ENV = "production";
    for (const name of REQUIRED_PROD_ENV) {
      delete process.env[name];
    }
    process.env.SIGNING_PRIVATE_KEY = SECRET_VALUES.SIGNING_PRIVATE_KEY;

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
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = SECRET_VALUES.DATABASE_URL;
    process.env.SIGNING_PRIVATE_KEY = SECRET_VALUES.SIGNING_PRIVATE_KEY;
    process.env.INGESTION_COMMITMENT_SALT =
      SECRET_VALUES.INGESTION_COMMITMENT_SALT;

    const result = validateEnv({ mode: "production" });
    expect(result.ok).toBe(true);
    expect(result.missingRequired).toEqual([]);
  });

  it("allows missing optional vars with warnings in development", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = SECRET_VALUES.DATABASE_URL;
    process.env.SIGNING_PRIVATE_KEY = SECRET_VALUES.SIGNING_PRIVATE_KEY;
    process.env.INGESTION_COMMITMENT_SALT =
      SECRET_VALUES.INGESTION_COMMITMENT_SALT;
    delete process.env.EVIDENCE_BRIDGE_OPERATOR_ID;
    delete process.env.EVIDENCE_ENFORCEMENT_ENABLED;
    delete process.env.NEXT_PUBLIC_APP_URL;

    const result = validateEnv({ mode: "development" });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes("EVIDENCE_BRIDGE_OPERATOR_ID"))).toBe(
      true
    );
  });

  it("skips enforcement in test mode", () => {
    process.env.NODE_ENV = "test";
    delete process.env.DATABASE_URL;
    delete process.env.SIGNING_PRIVATE_KEY;
    delete process.env.INGESTION_COMMITMENT_SALT;

    const result = validateEnv({ mode: "test" });
    expect(result.ok).toBe(true);
    expect(result.missingRequired).toEqual([]);
  });

  it("skips enforcement when VITEST=true", () => {
    process.env.VITEST = "true";
    delete process.env.DATABASE_URL;

    const result = validateEnv({ mode: "production" });
    expect(result.ok).toBe(true);
  });

  it("requires Stripe conditional group when STRIPE_SECRET_KEY is set", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = SECRET_VALUES.DATABASE_URL;
    process.env.SIGNING_PRIVATE_KEY = SECRET_VALUES.SIGNING_PRIVATE_KEY;
    process.env.INGESTION_COMMITMENT_SALT =
      SECRET_VALUES.INGESTION_COMMITMENT_SALT;
    process.env.STRIPE_SECRET_KEY = SECRET_VALUES.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_PRICE_PRO;
    delete process.env.NEXT_PUBLIC_APP_URL;

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
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = SECRET_VALUES.DATABASE_URL;
    process.env.SIGNING_PRIVATE_KEY = SECRET_VALUES.SIGNING_PRIVATE_KEY;
    process.env.INGESTION_COMMITMENT_SALT =
      SECRET_VALUES.INGESTION_COMMITMENT_SALT;
    process.env.STRIPE_SECRET_KEY = SECRET_VALUES.STRIPE_SECRET_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = SECRET_VALUES.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_PRICE_PRO = SECRET_VALUES.STRIPE_PRICE_PRO;
    process.env.NEXT_PUBLIC_APP_URL = SECRET_VALUES.NEXT_PUBLIC_APP_URL;

    const result = validateEnv({ mode: "production" });
    expect(result.ok).toBe(true);
    expect(result.enabledFlags.stripeConfigured).toBe(true);
  });
});

describe("getEnvReport", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns presence booleans without secret values", () => {
    process.env.DATABASE_URL = SECRET_VALUES.DATABASE_URL;
    process.env.EVIDENCE_ENFORCEMENT_ENABLED = "true";

    const report = getEnvReport();
    expect(report.presence.DATABASE_URL).toBe(true);
    expect(report.enabledFlags.evidenceEnforcement).toBe(true);
    expect(JSON.stringify(report)).not.toContain(SECRET_VALUES.DATABASE_URL);
  });
});
