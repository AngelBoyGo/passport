import { verify } from "@noble/ed25519";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";

/**
 * Relying-party verifier for "Sign in with Passport" id_tokens.
 *
 * This is what an APP pastes into its backend to accept an agent's sign-in.
 * It fetches the issuer JWKS (property 3: verify without trusting the issuer's
 * client), checks the EdDSA signature and the standard claims, and returns the
 * agent's stable subject + (for registered clients) the accountable owner.
 */

export interface PassportAgentClaims {
  sub: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  jti: string;
  owner_email?: string | null;
  owner_name?: string | null;
}

function b64urlToBytes (s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return new Uint8Array(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64"));
}

async function fetchJwks (issuer: string): Promise<{ x?: string }[]> {
  const res = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/jwks.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`jwks_fetch_failed_${res.status}`);
  const j = await res.json();
  return Array.isArray(j?.keys) ? j.keys : [];
}

export async function verifyPassportAgentToken (
  idToken: string,
  opts: { issuer: string; audience: string; now?: number }
): Promise<PassportAgentClaims | null> {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  let header: { alg?: string; kid?: string };
  let payload: PassportAgentClaims;
  try {
    header = JSON.parse(Buffer.from(b64urlToBytes(h)).toString("utf8"));
    payload = JSON.parse(Buffer.from(b64urlToBytes(p)).toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "EdDSA") return null;
  if (payload.iss !== opts.issuer.replace(/\/$/, "")) return null;
  if (payload.aud !== opts.audience) return null;
  if (typeof payload.exp === "number" && payload.exp < (opts.now ?? Math.floor(Date.now() / 1000))) return null;

  const keys = await fetchJwks(opts.issuer).catch(() => [] as { x?: string }[]);
  const key = keys.find((k) => (k as { x?: string }).x) as { x?: string } | undefined;
  if (!key?.x) return null;
  const pub = b64urlToBytes(key.x); // JWKS `x` is base64url of the raw Ed25519 key
  try {
    const ok = await verify(b64urlToBytes(s), utf8ToBytes(`${h}.${p}`), pub);
    if (!ok) return null;
  } catch {
    return null;
  }
  return payload;
}
