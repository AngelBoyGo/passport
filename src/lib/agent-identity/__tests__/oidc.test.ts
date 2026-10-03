import { describe, it, expect, beforeAll } from "vitest";

/**
 * Agent Identity — "Sign in with Passport" (ports the four properties of an
 * agent ID: stable subject, agent-held key, verifiable-without-trust, and an
 * accountable human). EdDSA/Ed25519 id_tokens.
 */

let OIDC: typeof import("../oidc");
const SIGNING_KEY = "ab".repeat(32); // 32-byte hex

beforeAll(async () => {
  process.env.SIGNING_PRIVATE_KEY = SIGNING_KEY;
  process.env.PASSPORT_ISSUER_URL = "https://passport.test";
  OIDC = await import("../oidc");
});

describe("agent identity · JWKS (property 3: verify without trusting the agent)", () => {
  it("publishes an EdDSA OKP key with a stable kid", () => {
    const jwks = OIDC.buildJwks();
    expect(jwks.keys).toHaveLength(1);
    const k = jwks.keys[0];
    expect(k.kty).toBe("OKP");
    expect(k.crv).toBe("Ed25519");
    expect(k.alg).toBe("EdDSA");
    expect(k.use).toBe("sig");
    expect(k.kid).toBe(OIDC.AGENT_IDENTITY_KID);
    expect(k.x).toBeTruthy();
  });
});

describe("agent identity · discovery", () => {
  it("advertises the endpoints and EdDSA alg", () => {
    const d = OIDC.buildDiscoveryDocument();
    expect(d.issuer).toBe("https://passport.test");
    expect(d.jwks_uri).toBe("https://passport.test/.well-known/jwks.json");
    expect(d.id_token_signing_alg_values_supported).toContain("EdDSA");
    expect(d.scopes_supported).toContain("owner_email");
    expect(d.claims_supported).toContain("owner_email");
  });
});

describe("agent identity · id_token mint + verify", () => {
  const SUB = "a".repeat(64);

  it("mints a verifiable token whose sub is the stable subject", async () => {
    const { id_token } = await OIDC.mintAgentIdToken({
      subjectCommitment: SUB,
      audience: "https://app.example.com",
      includeOwnerClaims: false,
    });
    const payload = await OIDC.verifyAgentIdToken(id_token);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe(SUB);
    expect(payload!.aud).toBe("https://app.example.com");
    expect(payload!.iss).toBe("https://passport.test");
    expect(typeof payload!.jti).toBe("string");
  });

  it("owner claims are present ONLY for registered clients", async () => {
    const open = await OIDC.mintAgentIdToken({
      subjectCommitment: SUB,
      audience: "https://app.example.com",
      includeOwnerClaims: false,
    });
    const openPayload = await OIDC.verifyAgentIdToken(open.id_token);
    expect(openPayload).not.toHaveProperty("owner_email");

    const reg = await OIDC.mintAgentIdToken({
      subjectCommitment: SUB,
      audience: "https://app.example.com",
      includeOwnerClaims: true,
      ownerEmail: "owner@clinic.com",
      ownerName: "owner",
    });
    const regPayload = await OIDC.verifyAgentIdToken(reg.id_token);
    expect(regPayload!.owner_email).toBe("owner@clinic.com");
    expect(regPayload!.owner_name).toBe("owner");
  });

  it("an expired token fails verification", async () => {
    const past = Math.floor(Date.now() / 1000) - 10_000;
    const { id_token } = await OIDC.mintAgentIdToken({
      subjectCommitment: SUB,
      audience: "https://app.example.com",
      includeOwnerClaims: false,
      now: past,
    });
    expect(await OIDC.verifyAgentIdToken(id_token)).toBeNull();
  });

  it("a tampered token fails verification", async () => {
    const { id_token } = await OIDC.mintAgentIdToken({
      subjectCommitment: SUB,
      audience: "https://app.example.com",
      includeOwnerClaims: false,
    });
    const tampered = id_token.slice(0, -4) + "AAAA";
    expect(await OIDC.verifyAgentIdToken(tampered)).toBeNull();
  });

  it("each sign-in carries a unique jti (no replay)", async () => {
    const a = await OIDC.mintAgentIdToken({ subjectCommitment: SUB, audience: "app", includeOwnerClaims: false });
    const b = await OIDC.mintAgentIdToken({ subjectCommitment: SUB, audience: "app", includeOwnerClaims: false });
    const pa = await OIDC.verifyAgentIdToken(a.id_token);
    const pb = await OIDC.verifyAgentIdToken(b.id_token);
    expect(pa!.jti).not.toBe(pb!.jti);
  });
});
