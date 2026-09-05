import { describe, expect, it } from "vitest";
import { GET as getGenesis } from "@/app/genesis/route";
import { GET as getProtocol } from "@/app/.well-known/swarm-protocol.json/route";

describe("Genesis & Swarm Protocol Discovery Endpoints", () => {
  it("GET /genesis returns executable shell script", async () => {
    const res = await getGenesis();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("#!/usr/bin/env sh");
    expect(text).toContain("PASSPORT SOVEREIGN AGENT GENESIS");
    expect(text).toContain("api/v1/passport/agents/autonomous/provision");
    expect(res.headers.get("Content-Type")).toContain("text/plain");
  });

  it("GET /.well-known/swarm-protocol.json returns protocol manifest", async () => {
    const res = await getProtocol();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.protocol).toContain("Passport Sovereign Swarm");
    expect(json.specification).toBe("ASMC-2");
    expect(json.endpoints.swarm_memory).toBe("https://passport.metis.gold/api/v1/swarm/memory");
    expect(json.client_libraries.typescript_sdk).toBe("@passport7/sdk");
  });
});
