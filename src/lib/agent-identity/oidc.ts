import { getPublicKey, sign, verify } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { sha256Hex } from "@/lib/receipt/canonical";
import "@/lib/receipt/crypto";

/**
 * Agent Identity — the four properties packaged as a portable OIDC issuer
 * ("Sign in with Passport").
 *
 * We deliberately do NOT adopt a vendor SDK. Passport already holds the four
 * ingredients; this module packages them so ANY OIDC-capable app can accept an
 * agent's sign-in and learn its accountable owner:
 *   1. stable subject  -> `sub` = the agent's subject_commitment
 *   2. agent-held key  -> the agent signs a per-login transaction; Passport
 *                         issues an id_token signed with its OWN EdDSA key
 *   3. verification    -> /.well-known/jwks.json (no need to trust the agent)
 *   4. accountable human -> `owner_email`/`owner_name` claim for registered
 *                         clients only (never returned to open clients)
 *
 * Algorithm is EdDSA (Ed25519) — the key Passport already has — so no new key
 * management is introduced.
 */

export const AGENT_IDENTITY_ISSUER =
  process.env.PASSPORT_ISSUER_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://passport.metis.gold";

export const AGENT_IDENTITY_KID = "passport-agent-identity-1";
const ID_TOKEN_TTL_SECONDS = 300; // id_tokens are short-lived; refresh via new sign-in

function b64url (bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlJson (obj: unknown): string {
  return b64url(utf8ToBytes(JSON.stringify(obj)));
}
function fromB64url (s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return new Uint8Array(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64"));
}

function privateKeyBytes (): Uint8Array {
  const hex = process.env.SIGNING_PRIVATE_KEY;
  if (!hex || (hex.length !== 64 && hex.length !== 128)) {
    throw new Error("SIGNING_PRIVATE_KEY is required to sign agent id_tokens");
  }
  return hexToBytes(hex.length === 128 ? hex.slice(0, 64) : hex);
}

/** The issuer's Ed25519 public key (hex) — same key that signs receipts. */
export function issuerPublicKeyHex (): string {
  return bytesToHex(getPublicKey(privateKeyBytes()));
}

/** 3. Verification path: a JWKS document an app fetches without trusting the agent. */
export function buildJwks (): { keys: Array<Record<string, string>> } {
  return {
    keys: [
      {
        kty: "OKP",
        crv: "Ed25519",
        use: "sig",
        alg: "EdDSA",
        kid: AGENT_IDENTITY_KID,
        x: b64url(hexToBytes(issuerPublicKeyHex())),
      },
    ],
  };
}

/** OIDC discovery document. */
export function buildDiscoveryDocument () {
  const iss = AGENT_IDENTITY_ISSUER.replace(/\/$/, "");
  return {
    issuer: iss,
    jwks_uri: `${iss}/.well-known/jwks.json`,
    authorization_endpoint: `${iss}/api/v1/agent-identity/authorize`,
    token_endpoint: `${iss}/api/v1/agent-identity/token`,
    userinfo_endpoint: `${iss}/api/v1/agent-identity/userinfo`,
    response_types_supported: ["id_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["EdDSA"],
    scopes_supported: ["openid", "owner_email"],
    claims_supported: ["sub", "iss", "aud", "exp", "iat", "jti", "owner_email", "owner_name"],
    grant_types_supported: ["urn:ietf:params:oauth:grant-type:jwt-bearer"],
  };
}

export interface AgentIdTokenInput {
  /** 1. stable subject */
  subjectCommitment: string;
  /** audience = the relying app's client_id */
  audience: string;
  /** 4. accountable human — only included for registered clients */
  ownerEmail?: string | null;
  ownerName?: string | null;
  /** whether the requesting client is registered (may receive owner claims) */
  includeOwnerClaims: boolean;
  now?: number;
}

/**
 * Mint an EdDSA (Ed25519) id_token. `owner_email`/`owner_name` are included ONLY
 * when `includeOwnerClaims` is true — mirroring the "registered apps only"
 * disclosure rule. Open clients never see the accountable human.
 */
export async function mintAgentIdToken (input: AgentIdTokenInput): Promise<{ id_token: string; expires_in: number }> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const header = { alg: "EdDSA", typ: "JWT", kid: AGENT_IDENTITY_KID };
  const payload: Record<string, unknown> = {
    iss: AGENT_IDENTITY_ISSUER.replace(/\/$/, ""),
    aud: input.audience,
    sub: input.subjectCommitment,
    iat: now,
    exp: now + ID_TOKEN_TTL_SECONDS,
    jti: sha256Hex(`${input.subjectCommitment}:${input.audience}:${now}:${Math.random()}`).slice(0, 32),
  };
  if (input.includeOwnerClaims) {
    payload.owner_email = input.ownerEmail || null;
    payload.owner_name = input.ownerName || null;
  }
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = await sign(utf8ToBytes(signingInput), privateKeyBytes());
  return { id_token: `${signingInput}.${b64url(sig)}`, expires_in: ID_TOKEN_TTL_SECONDS };
}

/** Verify an id_token (for tests / relying-party helpers). */
export async function verifyAgentIdToken (token: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const signingInput = `${parts[0]}.${parts[1]}`;
  try {
    const ok = await verify(fromB64url(parts[2]), utf8ToBytes(signingInput), hexToBytes(issuerPublicKeyHex()));
    if (!ok) return null;
    const payload = JSON.parse(Buffer.from(fromB64url(parts[1])).toString("utf8"));
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export const AGENT_IDENTITY_TTL_SECONDS = ID_TOKEN_TTL_SECONDS;

/**
 * Authorization codes for the BROWSER/owner-approval flow ("hand the sign-in to
 * your owner"). An owner approves an agent's sign-in in the browser; Passport
 * issues a short-lived, single-use code the agent (or the app) exchanges at the
 * token endpoint. Stored in `platform_settings` to avoid a schema migration.
 */
export const AUTH_CODE_TTL_SECONDS = 120;
const AUTH_CODE_PREFIX = "agentid:code:";

export interface AuthCodeRecord {
  agent_commitment: string;
  audience: string;
  scopes: string[];
  owner_email: string | null;
  owner_name: string | null;
  created_at: number; // unix seconds
}

function codeKey (code: string): string {
  return AUTH_CODE_PREFIX + code;
}

export function newAuthCode (): string {
  return sha256Hex(`agentid:${Date.now()}:${Math.random()}:${Math.random()}`).slice(0, 40);
}

/** Persist an authorization code (single-use, short TTL). */
export async function storeAuthCode (
  db: { collection: (n: string) => { updateOne: (q: unknown, u: unknown, o?: unknown) => Promise<unknown> } },
  code: string,
  record: AuthCodeRecord
): Promise<void> {
  await db.collection("platform_settings").updateOne(
    { key: codeKey(code) },
    { $set: { key: codeKey(code), value: record, updated_at: new Date() } },
    { upsert: true }
  );
}

/** Consume an authorization code exactly once. Returns null when missing/expired/used. */
export async function consumeAuthCode (
  db: { collection: (n: string) => { findOne: (q: unknown) => Promise<unknown>; deleteOne: (q: unknown) => Promise<unknown> } },
  code: string
): Promise<AuthCodeRecord | null> {
  const key = codeKey(code);
  const doc = (await db.collection("platform_settings").findOne({ key })) as
    | { value?: AuthCodeRecord }
    | null;
  const rec = doc?.value;
  if (!rec) return null;
  // Single-use: delete immediately so it can never be replayed.
  await db.collection("platform_settings").deleteOne({ key });
  if (Math.floor(Date.now() / 1000) - rec.created_at > AUTH_CODE_TTL_SECONDS) return null;
  return rec;
}
