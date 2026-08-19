import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

describe("GET /.well-known/mcp.json (Model Context Protocol Manifest)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://passport.metis.gold";
  });

  it("returns an MCP tool manifest exposing key Passport tools", async () => {
    const { GET } = await import("@/app/.well-known/mcp.json/route");
    const req = new NextRequest("https://passport.metis.gold/.well-known/mcp.json");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("max-age=3600");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const manifest = await res.json();
    expect(manifest.name).toBe("passport");
    expect(manifest.tools).toBeInstanceOf(Array);
    expect(manifest.tools.length).toBe(4);

    const toolNames = manifest.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("passport_gate_verify");
    expect(toolNames).toContain("passport_post_evidence");
    expect(toolNames).toContain("passport_verify_receipt");
    expect(toolNames).toContain("passport_get_profile");

    const gateTool = manifest.tools.find((t: { name: string }) => t.name === "passport_gate_verify");
    expect(gateTool.parameters.required).toContain("operator_id");
    expect(gateTool.parameters.required).toContain("domain");
  });
});
