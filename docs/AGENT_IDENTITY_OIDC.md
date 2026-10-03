# Sign in with Passport — Agent Identity (OIDC)

Any app can accept an AI agent's sign-in using Passport as a portable OpenID
Connect issuer — in the same position as "Sign in with Google". This ports the
four properties of an **agent ID** (stable subject, agent-held credential,
verification without trusting the agent, accountable human) onto Passport's
existing enrollment + owner model. **No vendor SDK, no external dependency.**

## The four properties → Passport mapping

| Property | Passport mechanism |
|---|---|
| 1 · Stable subject | `sub` = the agent's `subject_commitment` (unique, from enrollment) |
| 2 · Agent-held credential | The agent signs a per-login transaction with its Ed25519 private key; Passport never sees it |
| 3 · Verify without trusting the agent | `/.well-known/jwks.json` — an app checks the id_token signature against this |
| 4 · Accountable human | `owner_email` / `owner_name` claims, derived from `Agent(operatorId) → Operator`, disclosed to **registered clients only** |

id_tokens are signed **EdDSA (Ed25519)** with Passport's existing signing key, so
no new key management is introduced.

## Discovery

```
GET https://passport.metis.gold/.well-known/openid-configuration
GET https://passport.metis.gold/.well-known/jwks.json
```

Add Passport as a custom OIDC provider in Clerk / Supabase / Auth0 / Better Auth
/ Auth.js with just:

- **Issuer:** `https://passport.metis.gold`
- **Client ID:** your app's `audience` URL

## Sign-in flow

1. `POST /api/v1/agent-identity/authorize`
   `{ agent_commitment, audience }` → returns `{ nonce, transaction_digest }`.
2. The agent signs `transaction_digest` with its Ed25519 key.
3. `POST /api/v1/agent-identity/token`
   `{ agent_commitment, audience, nonce, signature, requested_scopes? }`
   → `{ id_token, expires_in }`.
4. The app verifies the id_token against JWKS and reads `sub` (+ owner claims if
   it requested the `owner_email` scope).

### Example id_token payload (registered client)

```json
{
  "iss": "https://passport.metis.gold",
  "aud": "https://yourapp.com",
  "sub": "a91f2c8e…43",
  "owner_email": "owner@clinic.com",
  "owner_name": "owner",
  "iat": 1767225000,
  "exp": 1767225300,
  "jti": "9f1c2a44…"
}
```

Open clients (no `owner_email` scope) receive the token **without** owner claims —
never a token with the claim silently missing.

## Delegated access (RFC 8693 token exchange)

An operator exchanges its API key for a token representing one of **its** agents
acting on its behalf — the Enterprise wedge:

```
POST /api/v1/agent-identity/token-exchange   (Bearer operator API key)
{ agent_commitment, audience, requested_scopes? }
-> { id_token, act: { sub: <operator_id> }, ... }
```

## Revocation (kill one agent, not the owner)

```
POST /api/v1/agent-identity/revoke   (owner API key or session)
{ agent_commitment }
```

Revoking records a `revoked_before` watermark for that subject; every id_token
issued before it is rejected by `/verify` and `/userinfo`, while the owner and
all their other agents are untouched.

## Verify an agent (server-side / MCP)

```
POST /api/v1/agent-identity/verify   { id_token, audience? }
```

Exposed as the MCP tool **`passport_verify_agent`** so an app — or another
agent — can confirm *who* is behind an agent before acting.

## PKCE

The browser/owner-approved flow supports **PKCE S256**: pass `code_challenge` +
`code_challenge_method=S256` to the consent endpoint and `code_verifier` to the
token endpoint. A code bound to a challenge cannot be redeemed without it.

## Discovery aliases

- `/.well-known/openid-configuration` (OIDC)
- `/.well-known/oauth-authorization-server` (RFC 8414 alias)

## Relying-party verification (drop-in)

```ts
import { verifyPassportAgentToken } from "passport/lib/agent-identity/verify-token";

const claims = await verifyPassportAgentToken(idToken, {
  issuer: "https://passport.metis.gold",
  audience: "https://yourapp.com",
});
if (!claims) return unauthorized();
// claims.sub = the stable agent identity; claims.owner_email = accountable human
```

`verify-token.ts` fetches the JWKS itself, so the app never has to trust
Passport's client library or hold a shared secret.

## Why this is commercially correct for Passport

The provider (app) receives an identity it can recognize again and a connection
to the owner; it can set permissions/limits on the agent and revoke it without
touching the human. Passport becomes the **cross-organizational** trust layer —
the category axis that Entra (tenant-only) cannot cross. Every app that adds
"Sign in with Passport" is a distribution channel, and Passport's reputation,
AngelCoin, and Marketplace become the natural next step for the agent that just
signed in.
