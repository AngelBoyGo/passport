import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

describe("GET /api/v1/openapi.json (OpenAPI 3.1.0)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://passport.metis.gold";
  });

  it("returns a valid OpenAPI 3.1.0 document with all key routes and security schemes", async () => {
    const { GET } = await import("@/app/api/v1/openapi.json/route");
    const req = new NextRequest("https://passport.metis.gold/api/v1/openapi.json");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("max-age=3600");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const spec = await res.json();
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toContain("Passport");
    expect(spec.components.securitySchemes.ApiKeyAuth.type).toBe("http");
    expect(spec.components.schemas.EvidenceIngestRequest).toBeDefined();

    // Verify key path coverage
    expect(spec.paths["/api/v1/gate/verify"]).toBeDefined();
    expect(spec.paths["/api/v1/receipts"]).toBeDefined();
    expect(spec.paths["/api/v1/receipts/{id}/public-manifest"]).toBeDefined();
    expect(spec.paths["/api/v1/passport/agents/{id}/evidence"]).toBeDefined();
    expect(spec.paths["/.well-known/agent.json"]).toBeDefined();
    expect(spec.paths["/api/v1/a2a/tasks"]).toBeDefined();
    expect(spec.paths["/api/v1/acp/task"]).toBeDefined();
    expect(spec.paths["/.well-known/did.json"]).toBeDefined();
    expect(spec.paths["/api/v1/anp/agents/{commitment}"]).toBeDefined();
    expect(spec.paths["/api/v1/agora/negotiate"]).toBeDefined();
  });
});
