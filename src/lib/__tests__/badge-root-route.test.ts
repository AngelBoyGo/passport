import { describe, expect, it } from "vitest";

describe("GET /api/v1/badge", () => {
  it("redirects visitors to the badge guide instead of returning a 404", async () => {
    const { GET } = await import("@/app/api/v1/badge/route");
    const response = await GET(new Request("https://passport.metis.gold/api/v1/badge") as import("next/server").NextRequest);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/badge");
  });
});
