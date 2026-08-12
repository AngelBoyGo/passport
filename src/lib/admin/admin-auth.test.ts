import { afterEach, describe, expect, it, vi } from "vitest";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";

const original = process.env.ADMIN_OPERATOR_EMAILS;

afterEach(() => {
  if (original === undefined) delete process.env.ADMIN_OPERATOR_EMAILS;
  else process.env.ADMIN_OPERATOR_EMAILS = original;
  vi.unstubAllEnvs();
});

describe("executive admin access", () => {
  it("matches the configured email allowlist case-insensitively", () => {
    process.env.ADMIN_OPERATOR_EMAILS = "ceo@passport.metis.gold";
    expect(isExecutiveAdmin({ email: "CEO@Passport.Metis.Gold" })).toBe(true);
    expect(isExecutiveAdmin({ email: "other@example.com" })).toBe(false);
  });

  it("allows local development without an allowlist", () => {
    delete process.env.ADMIN_OPERATOR_EMAILS;
    vi.stubEnv("NODE_ENV", "test");
    expect(isExecutiveAdmin({ email: "developer@example.com" })).toBe(true);
  });
});
