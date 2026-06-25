import { describe, expect, it } from "vitest";
import {
  classifyDatabaseUrl,
  createPassportDoctorPlan,
} from "@/lib/release/passport-doctor";
import type { EnvValidationResult } from "@/lib/config/env";

const passingEnvResult: EnvValidationResult = {
  ok: true,
  missingRequired: [],
  warnings: [],
  enabledFlags: {
    evidenceBridgeOperator: true,
    evidenceEnforcement: false,
    stripeConfigured: false,
  },
};

describe("classifyDatabaseUrl", () => {
  it("detects postgres and postgresql URLs", () => {
    expect(classifyDatabaseUrl("postgresql://user:pass@host:5432/db")).toBe(
      "postgres"
    );
    expect(classifyDatabaseUrl("postgres://user:pass@host:5432/db")).toBe(
      "postgres"
    );
  });

  it("detects sqlite file URLs", () => {
    expect(classifyDatabaseUrl("file:./dev.db")).toBe("sqlite");
    expect(classifyDatabaseUrl("sqlite:./dev.db")).toBe("sqlite");
  });

  it("handles missing and unknown URLs", () => {
    expect(classifyDatabaseUrl(undefined)).toBe("missing");
    expect(classifyDatabaseUrl("mysql://user:pass@host/db")).toBe("unknown");
  });
});

describe("createPassportDoctorPlan", () => {
  it("fails staging-style rollout when DATABASE_URL is sqlite", () => {
    const plan = createPassportDoctorPlan({
      mode: "staging",
      databaseUrl: "file:./dev.db",
      envResult: passingEnvResult,
    });

    expect(plan.exitCode).toBe(1);
    expect(plan.errors).toContain(
      "DATABASE_URL uses SQLite/file; staging/prod rollout requires PostgreSQL."
    );
    expect(plan.nextCommands).toEqual([
      "npx prisma migrate deploy",
      "deploy app",
      "BASE_URL=https://passport.example.com npm run smoke:github",
      "BASE_URL=https://passport.example.com npm run smoke:agent-enrollment",
    ]);
  });

  it("warns for local SQLite usage outside staging/prod", () => {
    const plan = createPassportDoctorPlan({
      mode: "development",
      databaseUrl: "file:./dev.db",
      envResult: passingEnvResult,
    });

    expect(plan.exitCode).toBe(0);
    expect(plan.warnings).toContain(
      "DATABASE_URL uses SQLite/file; this is local/dev-only, not a real rollout database."
    );
  });

  it("fails when required env validation reports missing vars", () => {
    const plan = createPassportDoctorPlan({
      mode: "production",
      databaseUrl: "postgresql://user:pass@host:5432/db",
      envResult: {
        ...passingEnvResult,
        ok: false,
        missingRequired: ["INGESTION_COMMITMENT_SALT"],
      },
    });

    expect(plan.exitCode).toBe(1);
    expect(plan.errors).toContain(
      "Missing required environment variables: INGESTION_COMMITMENT_SALT"
    );
  });
});
