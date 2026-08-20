import { describe, it, expect } from "vitest";
import { parseDatabaseUrlWithPoolConfig } from "@/lib/db";

describe("Database Connection Pool Configuration", () => {
  it("appends connection_limit and pool_timeout to PostgreSQL URL when not explicitly provided", () => {
    const rawUrl = "postgresql://user:pass@localhost:5432/passport?schema=public";
    const configured = parseDatabaseUrlWithPoolConfig(rawUrl, {
      connectionLimit: 10,
      poolTimeout: 15,
    });

    expect(configured).toContain("connection_limit=10");
    expect(configured).toContain("pool_timeout=15");
  });

  it("preserves explicit connection_limit and pool_timeout in URL", () => {
    const explicitUrl = "postgresql://user:pass@localhost:5432/passport?schema=public&connection_limit=25&pool_timeout=5";
    const configured = parseDatabaseUrlWithPoolConfig(explicitUrl, {
      connectionLimit: 10,
      poolTimeout: 15,
    });

    expect(configured).toContain("connection_limit=25");
    expect(configured).toContain("pool_timeout=5");
  });

  it("handles non-postgresql URLs safely without crashing", () => {
    const sqliteUrl = "file:./dev.db";
    const configured = parseDatabaseUrlWithPoolConfig(sqliteUrl);
    expect(configured).toBe(sqliteUrl);
  });
});
