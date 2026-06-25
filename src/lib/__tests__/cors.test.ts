import { describe, expect, it } from "vitest";
import {
  ADMIN_API_PATTERNS,
  AGENT_FRAMEWORKS,
  PASSPORT_ADMIN_ORIGINS,
  PUBLIC_API_PATTERNS,
  classifyApiRoute,
  getAdminApiCorsOptions,
  getPublicApiCorsOptions,
  resolveCorsHeaders,
} from "@/lib/security/cors";

describe("Passport production CORS corridor", () => {
  it("documents agent framework integrations served by public corridor", () => {
    expect(AGENT_FRAMEWORKS).toEqual(["Mastra", "LangGraph", "Claude Code"]);
  });

  it("classifies public gate and health endpoints", () => {
    for (const path of [
      "/api/v1/gate/verify",
      "/api/v1/public-key",
      "/api/health",
    ]) {
      expect(classifyApiRoute(path)).toBe("public");
      expect(PUBLIC_API_PATTERNS.some((re) => re.test(path))).toBe(true);
    }
  });

  it("classifies administrative receipt and checkout routes", () => {
    for (const path of [
      "/api/v1/receipts",
      "/api/v1/receipts/rcpt_1/finalize",
      "/api/stripe/checkout",
      "/api/demo/run",
    ]) {
      expect(classifyApiRoute(path)).toBe("admin");
      expect(ADMIN_API_PATTERNS.some((re) => re.test(path))).toBe(true);
    }
  });

  it("exempts Stripe webhook from admin origin gate", () => {
    expect(classifyApiRoute("/api/stripe/webhook")).toBe("webhook");
  });

  describe("getPublicApiCorsOptions", () => {
    it("allows GET and POST for external agent frameworks", () => {
      const options = getPublicApiCorsOptions();
      expect(options.allowedMethods).toEqual(["GET", "POST", "OPTIONS"]);
      expect(options.allowedOrigins).toBe("*");
    });
  });

  describe("getAdminApiCorsOptions", () => {
    it("restricts to passport.metis.gold namespace", () => {
      const options = getAdminApiCorsOptions();
      expect(options.allowedOrigins).toEqual([...PASSPORT_ADMIN_ORIGINS]);
      expect(options.allowedMethods).toEqual([
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
      ]);
    });
  });

  describe("resolveCorsHeaders", () => {
    it("reflects wildcard ACAO on public gate verify for agent frameworks", () => {
      const result = resolveCorsHeaders({
        pathname: "/api/v1/gate/verify",
        origin: "https://app.mastra.ai",
        method: "POST",
        isProduction: true,
      });
      expect(result.block).toBeUndefined();
      expect(result.headers["Access-Control-Allow-Origin"]).toBe("*");
      expect(result.headers["Access-Control-Allow-Methods"]).toContain("POST");
    });

    it("allows public GET without Origin (server-side LangGraph)", () => {
      const result = resolveCorsHeaders({
        pathname: "/api/v1/public-key",
        origin: null,
        method: "GET",
        isProduction: true,
      });
      expect(result.block).toBeUndefined();
      expect(result.headers["Access-Control-Allow-Origin"]).toBe("*");
    });

    it("blocks admin routes from foreign browser origins in production", () => {
      const result = resolveCorsHeaders({
        pathname: "/api/v1/receipts",
        origin: "https://evil.example.com",
        method: "POST",
        isProduction: true,
      });
      expect(result.block).toBe(true);
    });

    it("allows admin routes from https://passport.metis.gold", () => {
      const result = resolveCorsHeaders({
        pathname: "/api/v1/receipts",
        origin: "https://passport.metis.gold",
        method: "POST",
        isProduction: true,
      });
      expect(result.block).toBeUndefined();
      expect(result.headers["Access-Control-Allow-Origin"]).toBe(
        "https://passport.metis.gold"
      );
    });

    it("allows admin routes from passport.metis.gold hostname token", () => {
      const result = resolveCorsHeaders({
        pathname: "/api/stripe/checkout",
        origin: "passport.metis.gold",
        method: "POST",
        isProduction: true,
      });
      expect(result.block).toBeUndefined();
      expect(result.headers["Access-Control-Allow-Origin"]).toBe(
        "passport.metis.gold"
      );
    });

    it("allows server-side admin calls without Origin header", () => {
      const result = resolveCorsHeaders({
        pathname: "/api/v1/receipts",
        origin: null,
        method: "POST",
        isProduction: true,
      });
      expect(result.block).toBeUndefined();
    });

    it("never blocks Stripe webhook regardless of Origin", () => {
      const result = resolveCorsHeaders({
        pathname: "/api/stripe/webhook",
        origin: "https://stripe.com",
        method: "POST",
        isProduction: true,
      });
      expect(result.block).toBeUndefined();
    });
  });
});
