import { describe, it, expect } from "vitest";
import {
  DELEGATION_SCOPES,
  buildDelegationMessage,
  hashDelegationToken,
  validateDelegationScope,
} from "@/lib/delegation/delegation";

describe("Delegation System", () => {
  it("has exactly 5 scopes", () => {
    expect(DELEGATION_SCOPES).toEqual([
      "read_reputation",
      "post_evidence",
      "hire_agents",
      "manage_wallet",
      "send_messages",
    ]);
  });

  it("buildDelegationMessage is deterministic", () => {
    const params = {
      agent_commitment: "a".repeat(64),
      platform_name: "metis",
      scopes: ["read_reputation", "post_evidence"],
      nonce: "test_nonce_123",
      expiry_days: 30,
    };
    const msg1 = buildDelegationMessage(params);
    const msg2 = buildDelegationMessage(params);
    expect(msg1).toBe(msg2);
    expect(msg1).toContain("passport:delegate");
    expect(msg1).toContain("metis");
    expect(msg1).toContain("post_evidence,read_reputation");
  });

  it("scopes are sorted in the message (canonical)", () => {
    const params = {
      agent_commitment: "a".repeat(64),
      platform_name: "test",
      scopes: ["send_messages", "read_reputation"],
      nonce: "nonce_1",
      expiry_days: 7,
    };
    const msg = buildDelegationMessage(params);
    expect(msg).toContain("read_reputation,send_messages");
  });

  it("hashDelegationToken is deterministic and different for different tokens", () => {
    const h1 = hashDelegationToken("pdel_abc123");
    const h2 = hashDelegationToken("pdel_abc123");
    const h3 = hashDelegationToken("pdel_xyz789");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("validateDelegationScope returns valid for active token with matching scope", () => {
    const tokenData = {
      scopes: ["read_reputation", "post_evidence"],
      expiresAt: new Date(Date.now() + 86400000),
      revoked: false,
    };
    expect(validateDelegationScope(tokenData, "read_reputation")).toBe("valid");
    expect(validateDelegationScope(tokenData, "post_evidence")).toBe("valid");
  });

  it("validateDelegationScope returns null for missing scope", () => {
    const tokenData = {
      scopes: ["read_reputation"],
      expiresAt: new Date(Date.now() + 86400000),
      revoked: false,
    };
    expect(validateDelegationScope(tokenData, "hire_agents")).toBeNull();
  });

  it("validateDelegationScope returns null for revoked token", () => {
    const tokenData = {
      scopes: ["read_reputation"],
      expiresAt: new Date(Date.now() + 86400000),
      revoked: true,
    };
    expect(validateDelegationScope(tokenData, "read_reputation")).toBeNull();
  });

  it("validateDelegationScope returns null for expired token", () => {
    const tokenData = {
      scopes: ["read_reputation"],
      expiresAt: new Date(Date.now() - 86400000),
      revoked: false,
    };
    expect(validateDelegationScope(tokenData, "read_reputation")).toBeNull();
  });

  it("validateDelegationScope returns null for null token", () => {
    expect(validateDelegationScope(null, "read_reputation")).toBeNull();
  });
});