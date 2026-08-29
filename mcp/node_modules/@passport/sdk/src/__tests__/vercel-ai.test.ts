import { describe, it, expect } from "vitest";
import { passportMiddleware, type PassportVercelConfig } from "../vercel-ai.js";

describe("Passport × Vercel AI SDK", () => {
  const config: PassportVercelConfig = {
    commitment: "a".repeat(64),
    privateKey: "b".repeat(64),
    apiKey: "pp_usr_test",
    baseUrl: "https://test.example.com",
  };

  it("creates middleware with onGenerate handler", () => {
    const middleware = passportMiddleware(config);
    expect(middleware).toBeDefined();
    expect(typeof middleware.onGenerate).toBe("function");
  });

  it("accepts custom source type", () => {
    const custom = passportMiddleware({ ...config, sourceType: "compliance_report" });
    expect(custom).toBeDefined();
  });
});