import Link from "next/link";

export const metadata = {
  title: "Object-Level Authorization & Signed Agent Intents",
  description:
    "How Passport authorizes value-moving requests: caller authentication, resource ownership, and Ed25519-signed agent intents bound to the exact operation (nonce + expiry).",
};

export default function DocsAuthorization() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Authorization & Signed Agent Intents</h1>
        <p className="mt-2 text-slate-600">
          Authenticating the caller is not enough — a value-moving request must prove the caller
          may act on <em>this specific resource</em>, and an agent-initiated action must prove the{" "}
          <em>agent itself</em> authorized the exact operation. Passport enforces both.
        </p>
      </div>

      <section>
        <h2 className="text-xl font-semibold">Two gates</h2>
        <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
          <li>
            <strong>Caller authentication</strong> — a valid ISSUER or HOLDER API key.
          </li>
          <li>
            <strong>Resource authorization</strong> — an ISSUER key may act on any resource; a
            HOLDER key may act only on agents it owns, escrows it is a party to, or rails it
            authorized. Resolved by one primitive so the check cannot be forgotten per route.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Signed agent intents</h2>
        <p className="text-sm text-slate-600 mt-2">
          Agent-initiated value routes (AMM swap/fractionalize, escrow release) require a HOLDER
          caller to attach an <code className="font-mono text-xs">intent</code>: an Ed25519
          signature over the canonical operation, verified against the agent&apos;s registered
          enrollment key. The intent binds the action, the resource, the exact params
          (pool/token/amount, batch, assay certificate), a one-time{" "}
          <code className="font-mono text-xs">nonce</code>, and an{" "}
          <code className="font-mono text-xs">expires_at</code> timestamp. Tampered params, an
          expired intent, or a replayed nonce are rejected.
        </p>
        <pre className="mt-3 rounded-lg bg-slate-900 p-4 text-xs text-slate-100 overflow-x-auto">{`# canonical (signable) form — signature over utf8(canonicalJson(...))
{
  "action": "amm.swap",
  "agent_commitment": "<64-hex>",
  "resource_kind": "agent",
  "resource_id": "<64-hex>",
  "params": { "pool_id": "POOL-ANGEL-MAU-GOLD", "input_token": "ANGEL", "input_amount": 10 },
  "nonce": "<unique>",
  "expires_at": "2026-01-01T00:05:00.000Z"
}

POST /api/v1/reserves/amm/swap
{ "pool_id": "...", "agent_commitment": "...", "input_token": "ANGEL", "input_amount": 10,
  "intent": { ...canonical fields..., "signature": "<128-hex>" } }`}</pre>
        <p className="text-sm text-slate-600 mt-2">
          An ISSUER key remains an authorized alternative for delegated operations (no intent
          required). Intents are single-use; each nonce is consumed once.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Non-regressable</h2>
        <p className="text-sm text-slate-600 mt-2">
          A test enumerates every mutating route under <code className="font-mono text-xs">reserves/</code>{" "}
          and <code className="font-mono text-xs">raillab/</code> and fails, by name, if a route
          has no recognized authorization marker — so a new unguarded value route cannot ship
          silently. Routes authorized by a signature verified inside their service (or public by
          design) are explicitly allowlisted.
        </p>
        <p className="text-sm text-slate-600 mt-2">
          Related:{" "}
          <Link className="text-indigo-600 underline" href="/docs/posture">
            System Posture
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
