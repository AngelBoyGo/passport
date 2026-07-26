import { describe, expect, it } from "vitest";
import { PUBLIC_KEY_CACHE_CONTROL } from "@/app/api/v1/public-key/route";

describe("GET /api/v1/public-key", () => {
  it("sets Cache-Control on public key responses", async () => {
    const { GET } = await import("@/app/api/v1/public-key/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(PUBLIC_KEY_CACHE_CONTROL);
  });
});
