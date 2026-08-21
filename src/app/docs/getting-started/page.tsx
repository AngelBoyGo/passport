import Link from "next/link";

export default function DocsGettingStarted() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Quickstart</h1>
        <p className="mt-2 text-slate-600">
          Get an agent enrolled and posting receipts in under 5 minutes.
        </p>
      </div>

      <div className="rounded-lg border-l-4 border-indigo-500 bg-indigo-50 p-4 text-sm text-indigo-900">
        <strong>Prerequisites:</strong> You need an API key. Sign up via Stripe
        or use the dev provision endpoint in development.
      </div>

      <Section title="1. Get an API key (Dual-Tier Access)">
        <p className="text-sm text-slate-600">
          Passport provides two distinct API key tiers:
        </p>
        <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
          <li><strong>Enterprise Platform Issuer (<code className="font-mono text-xs text-indigo-600">pp_ent_...</code>):</strong> For platforms, data center infrastructure software, or multi-agent orchestrators that manage fleets, mint child passports, and anchor bulk evidence.</li>
          <li><strong>Agent Holder (<code className="font-mono text-xs text-indigo-600">pp_usr_...</code>):</strong> For individual autonomous agents, indie builders, or single cluster nodes that hold their own reputation and export receipts.</li>
        </ul>
        <CodeBlock>
          {`# Generate via /dashboard or call the API:
curl -X POST https://passport.metis.gold/api/v1/operator/api-keys \\
  -H "Authorization: Bearer pp_ent_<admin_key>" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Fleet Key", "role": "ISSUER"}'

# Store the returned rawKey — it is shown once.`}
        </CodeBlock>
      </Section>

      <Section title="Autonomous Agent Self-Provisioning (Zero-Human Flow)">
        <p className="text-sm text-slate-600">
          Autonomous AI agents can self-provision a Passport identity and Holder API key without human email verification using our Proof-of-Work (PoW) and Proof-of-Possession challenge:
        </p>
        <CodeBlock>
          {`# Step 1: Request an ephemeral challenge nonce
curl -X POST https://passport.metis.gold/api/v1/passport/agents/autonomous/challenge \\
  -H "Content-Type: application/json" \\
  -d '{"public_key": "<64-hex-ed25519-public-key>"}'

# Step 2: Solve lightweight PoW & sign digest sha256(nonce + ":" + pow_nonce + ":" + pubkey)
# Step 3: Complete self-provisioning
curl -X POST https://passport.metis.gold/api/v1/passport/agents/autonomous/provision \\
  -H "Content-Type: application/json" \\
  -d '{
    "public_key": "<64-hex-ed25519-public-key>",
    "challenge_nonce": "<nonce-from-step-1>",
    "pow_nonce": "<solved-pow-nonce>",
    "signature": "<128-hex-ed25519-signature>",
    "display_name": "AutonomousReviewer",
    "domain": "CODE_GENERATION"
  }'

# Returns: { "api_key": "pp_usr_...", "role": "HOLDER", "did": "did:key:z...", "subject_commitment": "..." }`}
        </CodeBlock>
      </Section>

      <Section title="2. Enroll an agent">
        <p className="text-sm text-slate-600">
          Every agent needs a Passport before it can post receipts. Enrollment
          uses an ed25519 challenge-response protocol.
        </p>
        <CodeBlock>
          {`# Step 2a: Start enrollment with the agent's public key
curl -X POST https://passport.metis.gold/api/v1/passport/agents/enroll/start \\
  -H "Content-Type: application/json" \\
  -d '{"public_key": "<64-char-hex-ed25519-pubkey>"}'

# Returns: { challenge_nonce: "..." }
# The agent must sign this nonce with its private key.`}
        </CodeBlock>
        <CodeBlock>
          {`# Step 2b: Complete enrollment with the signed challenge
curl -X POST https://passport.metis.gold/api/v1/passport/agents/enroll/complete \\
  -H "Content-Type: application/json" \\
  -d '{
    "subject_commitment": "<64-char-hex-commitment>",
    "signature": "<128-char-hex-ed25519-signature>"
  }'

# Returns: { status: "ISSUED", passport: { ... } }
# The agent now has an active Passport.`}
        </CodeBlock>
      </Section>

      <Section title="3. Issue a receipt">
        <p className="text-sm text-slate-600">
          With an enrolled agent, issue a signed receipt for their work.
          Requires API key auth + gate pass.
        </p>
        <CodeBlock>
          {`curl -X POST https://passport.metis.gold/api/v1/receipts \\
  -H "Authorization: Bearer pp_<your-api-key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "agent_id": "<agent-id>",
    "receipt_type": "competence",
    "input_digest": "<sha256-of-input>",
    "authority_scope": "fulfillment.demo",
    "expiry": "2026-12-31T00:00:00.000Z",
    "domain": "CODE_GENERATION"
  }'

# Returns: { receipt_id: "rcpt_...", status: "pending", ... }`}
        </CodeBlock>
      </Section>

      <Section title="4. Finalize with outcome">
        <CodeBlock>
          {`curl -X POST https://passport.metis.gold/api/v1/receipts/<receipt_id>/finalize \\
  -H "Authorization: Bearer pp_<your-api-key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "status": "success",
    "output_hash": "<sha256-of-output>"
  }'

# The receipt is now signed with the verifier's ed25519 key.
# Anyone can verify it at /verify/<receipt_id>.`}
        </CodeBlock>
      </Section>

      <Section title="5. Verify">
        <p className="text-sm text-slate-600">
          Open <code className="rounded bg-slate-100 px-1 font-mono text-xs">/verify/{`<receipt_id>`}</code> in a
          browser, or verify programmatically using the public key:
        </p>
        <CodeBlock>
          {`# Get the public key
curl https://passport.metis.gold/api/v1/public-key

# Returns: { algorithm: "ed25519", public_key: "<64-char-hex>" }`}
        </CodeBlock>
      </Section>

      <Section title="6. Post evidence (alternative flow)">
        <p className="text-sm text-slate-600">
          Instead of issuing receipts directly, you can post evidence and let
          the bridge create receipts automatically.
        </p>
        <CodeBlock>
          {`# For task_deliverable evidence (requires service token):
curl -X POST https://passport.metis.gold/api/v1/passport/agents/<commitment>/evidence \\
  -H "Authorization: Bearer <PASSPORT_SERVICE_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "source_type": "task_deliverable",
    "payload": "<opaque-blob>",
    "signature": "<ed25519-signature-of-payload>"
  }'`}
        </CodeBlock>

        <div className="mt-4 rounded-lg border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>⚠️ Critical: Recursive canonical JSON required</strong>
          <p className="mt-1">
            The server canonicalizes only the top level of the received JSON
            object. If your payload contains nested objects with unordered keys,
            the server&apos;s computed digest will differ from the client&apos;s
            signed digest, and the submission will be rejected with a
            validation error.
          </p>
          <p className="mt-1">
            <strong>Fix:</strong> Emit recursively key-sorted canonical JSON as
            the raw request body. Do not use <code className="rounded bg-amber-100 px-1 font-mono text-xs">JSON.stringify(obj)</code> on a
            top-level-sorted object — you must sort keys at every nesting level.
            Consider using <code className="rounded bg-amber-100 px-1 font-mono text-xs">canonicalize(obj)</code> from the{" "}
            <code className="rounded bg-amber-100 px-1 font-mono text-xs">canonical-json</code> npm package, or the deterministic
            JSON serialization built into the Passport client SDK.
          </p>
        </div>
      </Section>

      <div className="border-t pt-6 text-sm text-slate-500">
        Next:{" "}
        <Link href="/docs/api-reference" className="text-indigo-600 hover:underline">
          Full API Reference →
        </Link>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border bg-slate-950 p-4 text-sm text-slate-200">
      <code>{children}</code>
    </pre>
  );
}