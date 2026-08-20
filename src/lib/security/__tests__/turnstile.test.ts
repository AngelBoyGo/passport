import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyTurnstileToken } from "@/lib/security/turnstile";

describe("Cloudflare Turnstile Bot Protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  it("allows through when Turnstile is not configured (no TURNSTILE_SECRET_KEY)", async () => {
    const result = await verifyTurnstileToken("dummy-token");
    expect(result.success).toBe(true);
  });

  it("returns success:false when Turnstile verification fails", async () => {
    process.env.TURNSTILE_SECRET_KEY = "0x4AAAAAAAEPS_ABCDEF";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }),
        { status: 200 }
      )
    );
    const result = await verifyTurnstileToken("invalid-token");
    expect(result.success).toBe(false);
  });

  it("returns success:true when Turnstile verification succeeds", async () => {
    process.env.TURNSTILE_SECRET_KEY = "0x4AAAAAAAEPS_ABCDEF";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const result = await verifyTurnstileToken("valid-token");
    expect(result.success).toBe(true);
  });
});
