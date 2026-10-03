import { describe, it, expect } from "vitest";
import { newAuthCode, storeAuthCode, consumeAuthCode, AUTH_CODE_TTL_SECONDS } from "../oidc";

/** Minimal in-memory platform_settings store. */
function fakeDb() {
  const rows: Record<string, { value: unknown }> = {};
  return {
    rows,
    collection: () => ({
      async updateOne(q: { key: string }, u: { $set: { value: unknown } }) { rows[q.key] = { value: u.$set.value }; return {}; },
      async findOne(q: { key: string }) { return rows[q.key] ?? null; },
      async deleteOne(q: { key: string }) { const had = Boolean(rows[q.key]); delete rows[q.key]; return { deletedCount: had ? 1 : 0 }; },
    }),
  };
}

describe("authorization codes (owner-approved browser flow)", () => {
  it("stores and consumes a code exactly once", async () => {
    const db = fakeDb();
    const code = newAuthCode();
    await storeAuthCode(db as never, code, {
      agent_commitment: "a".repeat(64),
      audience: "https://app.example.com",
      scopes: ["openid", "owner_email"],
      owner_email: "owner@clinic.com",
      owner_name: "owner",
      created_at: Math.floor(Date.now() / 1000),
    });
    const first = await consumeAuthCode(db as never, code);
    expect(first).not.toBeNull();
    expect(first!.owner_email).toBe("owner@clinic.com");
    // Single-use: second consume fails.
    const second = await consumeAuthCode(db as never, code);
    expect(second).toBeNull();
  });

  it("rejects an expired code", async () => {
    const db = fakeDb();
    const code = newAuthCode();
    await storeAuthCode(db as never, code, {
      agent_commitment: "a".repeat(64),
      audience: "https://app.example.com",
      scopes: ["openid"],
      owner_email: null,
      owner_name: null,
      created_at: Math.floor(Date.now() / 1000) - (AUTH_CODE_TTL_SECONDS + 60),
    });
    expect(await consumeAuthCode(db as never, code)).toBeNull();
  });

  it("rejects an unknown code", async () => {
    const db = fakeDb();
    expect(await consumeAuthCode(db as never, "nope")).toBeNull();
  });
});
