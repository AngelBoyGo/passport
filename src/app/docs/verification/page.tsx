import Link from "next/link";

export default function DocsVerification() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Trust, Evidence & Independent Verification</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          How Passport anchors evidence, computes receipts, and lets a third party independently verify a
          receipt <strong>without trusting Passport's word</strong>. This is the specification for exactly what
          bytes get hashed and signed, so you can reproduce the math offline.
        </p>
      </div>

      {/* ── 1. Evidence Ingestion: six source types ── */}
      <Section
        title="1. Evidence Ingestion — the six source types"
        blurb="POST /api/v1/passport/agents/:subject_commitment/evidence accepts exactly these source_type values. The payload must be a JSON OBJECT (never a raw string)."
      >
        <div className="space-y-4">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="pb-2 pr-2 font-medium">source_type</th>
                <th className="pb-2 font-medium">Required payload shape (all optional unless noted)</th>
              </tr>
            </thead>
            <tbody className="text-slate-600 font-mono text-xs">
              <tr className="border-b">
                <td className="py-2 pr-2 whitespace-nowrap">github_push_webhook</td>
                <td className="py-2">{`{ ref?, repository?: { full_name?, html_url? }, head_commit?: { id?, sha?, message?, author?: { name?, email? } }, commits?: [{ id?, sha?, message?, raw?, html_url?, author? }] }`}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-2 whitespace-nowrap">github_commit_payload</td>
                <td className="py-2">{`{ sha?, html_url?, commit?: { message?, author?: { name?, email? }, committer?: { name?, email? } } }`}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-2 whitespace-nowrap">github_issue_event</td>
                <td className="py-2">{`{ agent_identity?, repository?, issue?: { id?, number?, url?, title? }, labels?: string[], action?, summary?, transcript_url?, observed_at? }`}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-2 whitespace-nowrap">compliance_report</td>
                <td className="py-2">{`{ agent_identity?, control_domain?, report_id?, report?: { id?, url?, title? }, action?, transcript_url?, observed_at? }`}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-2 whitespace-nowrap">otel_genai_trace</td>
                <td className="py-2">{`{ name?, attributes?: Record<string, unknown>, status?: { code?: string | number, message? }, startTimeUnixNano?, endTimeUnixNano?, start_time?, end_time? }`}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-2 whitespace-nowrap">task_deliverable</td>
                <td className="py-2">{`{ task_id: string, digest: "64-hex" (REQUIRED), observed_at? }`}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── 2. Canonicalization before signing ── */}
      <Section
        title="2. Canonicalization before signing (critical)"
        blurb="The agent signs the payload digest. Getting this exactly right is the most common integration failure."
      >
        <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Signing rule for evidence ingestion:</strong>
          <ol className="mt-2 list-decimal pl-5 space-y-1">
            <li>Serialize the payload as JSON with object keys <strong>recursively sorted</strong> (canonical JSON).</li>
            <li>Compute <code className="px-1 font-mono text-xs">event_digest = sha256-hex(canonicalJson(payload))</code>.</li>
            <li>Sign the UTF-8 bytes of that hex digest with the agent's Ed25519 private key.</li>
            <li>Send <code className="px-1 font-mono text-xs">signature</code> as the 128-hex Ed25519 signature over that digest.</li>
          </ol>
          <p className="mt-2 text-xs">
            The payload is a JSON <strong>object</strong>. If you send a string, ingestion fails with{" "}
            <code className="px-1 font-mono text-xs">400</code> /{" "}
            <code className="px-1 font-mono text-xs">401</code>. Do not use{" "}
            <code className="px-1 font-mono text-xs">JSON.stringify(obj)</code> on only the top level — every nesting
            level must be key-sorted, matching <code className="px-1 font-mono text-xs">canonicalJson</code>.
          </p>
        </div>
      </Section>

      {/* ── 3. Receipt content_hash canonicalization ── */}
      <Section
        title="3. Receipt content_hash canonicalization (offline verification)"
        blurb="To independently verify a receipt, recompute the content_hash from the canonical field set, then check the Ed25519 signature over that hash."
      >
        <div className="rounded-lg border-l-4 border-indigo-500 bg-indigo-50 p-4 text-sm text-indigo-900">
          <strong>Canonical field set (always present):</strong>{" "}
          <code className="px-1 font-mono text-xs">
            receipt_id, issued_at, operator_id, agent_id, receipt_type, status, input_digest, authority_scope,
            expiry, revocation_status
          </code>
          <p className="mt-2">
            <strong>Optional fields (included only when defined):</strong>{" "}
            <code className="px-1 font-mono text-xs">
              output_hash, refusal_reason, terminal_reason, prev_receipt_hash, domain, error_tranche
            </code>
          </p>
          <ol className="mt-2 list-decimal pl-5 space-y-1">
            <li>Build the canonical object from the fields above (exclude <code className="px-1 font-mono text-xs">signature</code> and <code className="px-1 font-mono text-xs">content_hash</code>).</li>
            <li>Serialize with key-sorted canonical JSON where omission of undefined optional fields is preserved.</li>
            <li>Compute <code className="px-1 font-mono text-xs">content_hash = sha256-hex(canonicalJson(payload))</code>.</li>
            <li>The Ed25519 signature signs the UTF-8 bytes of <code className="px-1 font-mono text-xs">content_hash</code>.</li>
          </ol>
          <p className="mt-2 text-xs">
            A masked public manifest is available at{" "}
            <code className="px-1 font-mono text-xs">GET /api/v1/receipts/:id/public-manifest</code> with the
            commitment hash, signature, verification status, and Merkle inclusion path. Public key resolution uses
            <code className="px-1 font-mono text-xs"> GET /api/v1/public-key</code> (current) and{" "}
            <code className="px-1 font-mono text-xs">/api/v1/public-key/key-history</code> (per-<code className="px-1 font-mono text-xs">kid</code>).
          </p>
        </div>
      </Section>

      {/* ── Evidence → Receipt auto-bridge ── */}
      <div className="rounded-lg border-l-4 border-emerald-500 bg-emerald-50 p-4 text-sm text-emerald-900">
        <strong>Evidence → Receipt auto-bridge:</strong> When enabled, each accepted evidence event is automatically
        minted into a signed <code className="px-1 font-mono text-xs">custody</code> receipt via the evidence bridge.
        Enable with <code className="px-1 font-mono text-xs">EVIDENCE_BRIDGE_AUTO_ENABLED=true</code> and provision a
        dedicated minter operator via <code className="px-1 font-mono text-xs">EVIDENCE_BRIDGE_OPERATOR_ID</code> (its
        credit balance funds the minting). The bridge is idempotent on{" "}
        <code className="px-1 font-mono text-xs">eventCommitmentHash</code>, so replayed events never double-mint.
      </div>

      {/* ── 4. Signed webhook contract ── */}
      <Section
        title="4. Signed webhook contract"
        blurb="How Passport signs webhook events so consumers can verify authenticity."
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            Events: <code className="px-1 font-mono text-xs">evidence.anchored</code>,{" "}
            <code className="px-1 font-mono text-xs">enrollment.completed</code>,{" "}
            <code className="px-1 font-mono text-xs">reputation.degraded</code>,{" "}
            <code className="px-1 font-mono text-xs">reputation.restored</code>,{" "}
            <code className="px-1 font-mono text-xs">reputation.milestone</code>.
          </p>
          <p>
            <strong>Headers:</strong>{" "}
            <code className="px-1 font-mono text-xs">X-Passport-Event</code> (event name) and{" "}
            <code className="px-1 font-mono text-xs">X-Passport-Signature</code>.
          </p>
          <p>
            <strong>Signing scheme:</strong>{" "}
            <code className="px-1 font-mono text-xs">
              signature = sha256-hex(canonicalJson({"{ event, data, timestamp }"}) + secret)
            </code>{" "}
            where <code className="px-1 font-mono text-xs">secret</code> is the per-subscription{" "}
            <code className="px-1 font-mono text-xs">whsec_...</code> returned at registration.
          </p>
          <p>
            <strong>Body shape:</strong>{" "}
            <code className="px-1 font-mono text-xs">{`{ "event": string, "data": object, "timestamp": ISO-8601 }`}</code>
          </p>
          <p>
            <strong>Retry semantics:</strong> Delivery retries up to 3 attempts with exponential backoff (1s, 2s, 4s)
            and a 5-second per-attempt timeout; a delivery that still fails is marked{" "}
            <code className="px-1 font-mono text-xs">deadLetter: true</code>.
          </p>
        </div>
      </Section>

      {/* ── OTel GenAI note ── */}
      <div className="rounded-lg border-l-4 border-sky-500 bg-sky-50 p-4 text-sm text-sky-900">
        <strong>otel_genai_trace — OTel GenAI semantic conventions:</strong> Passport accepts standard{" "}
        <code className="px-1 font-mono text-xs">gen_ai.*</code> span attributes. Recognized{" "}
        <code className="px-1 font-mono text-xs">gen_ai.operation.name</code> values:{" "}
        <code className="px-1 font-mono text-xs">chat, completion, embeddings, tool, agent, invoke_agent, run_agent, task, team</code>.
        Agent identity is read from <code className="px-1 font-mono text-xs">gen_ai.agent.id</code>,{" "}
        <code className="px-1 font-mono text-xs">gen_ai.agent.name</code>,{" "}
        <code className="px-1 font-mono text-xs">gen_ai.participant.id</code>, or falling back to{" "}
        <code className="px-1 font-mono text-xs">gen_ai.request.model</code>. Token usage is read from{" "}
        <code className="px-1 font-mono text-xs">gen_ai.usage.input_tokens/output_tokens</code> (and{" "}
        <code className="px-1 font-mono text-xs">prompt_tokens/completion_tokens</code> variants). Status code may be
        the OTel string <code className="px-1 font-mono text-xs">"ERROR"</code> or the integer{" "}
        <code className="px-1 font-mono text-xs">2</code>.
      </div>

      {/* ── Portable reputation ── */}
      <div className="rounded-lg border-l-4 border-emerald-500 bg-emerald-50 p-4 text-sm text-emerald-900">
        <strong>Portable agent reputation (W3C VC):</strong> Every enrolled agent can produce a self-contained{" "}
        <code className="px-1 font-mono text-xs">AgentReputationCredential</code> (Ed25519-signed, W3C VC 2.0) that
        travels between gateways. Fetch it at{" "}
        <code className="px-1 font-mono text-xs">GET /api/v1/credentials/:commitment</code> and verify at{" "}
        <code className="px-1 font-mono text-xs">POST /api/v1/credentials/verify</code> without calling Passport at
        request time. The A2A agent card (<code className="px-1 font-mono text-xs">/.well-known/agent.json</code>)
        embeds the <code className="px-1 font-mono text-xs">portable_reputation</code> reference so standing is
        discoverable with a device&apos;s identity.
      </div>

      {/* ── 5. Environment requirement ── */}
      <Section
        title="5. Production environment requirement: INGESTION_COMMITMENT_SALT"
        blurb="Evidence anchoring requires a stable commitment salt in production."
      >
        <div className="rounded-lg border-l-4 border-emerald-500 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p>
            A correctly-signed evidence POST returns{" "}
            <code className="px-1 font-mono text-xs">500 INGESTION_COMMITMENT_SALT is required outside test environments</code>{" "}
            unless the operator has set <code className="px-1 font-mono text-xs">INGESTION_COMMITMENT_SALT</code> in
            the production environment. This salt is a long random value that must be stable across all app instances
            and never committed to git. The admin command center surfaces its status in the health panel. If it is
            missing, <strong>no agent can anchor evidence</strong> — treat it as a production incident.
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

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {blurb && <p className="mt-1 text-sm text-slate-500">{blurb}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
