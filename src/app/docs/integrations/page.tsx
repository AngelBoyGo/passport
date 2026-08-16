import Link from "next/link";

export default function DocsIntegrations() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Integrations</h1>
        <p className="mt-2 text-slate-600">
          Connect any agent framework to Passport. The API is framework-agnostic
          — just POST evidence to the right endpoint.
        </p>
      </div>

      <IntegrationCard
        name="LangGraph"
        description="Send task deliverables from LangGraph agent runs to Passport."
        steps={[
           "After each agent run, extract the task result and agent ID",
           "Build { task_id, digest, observed_at }, hash its canonical JSON, and sign that 64-character digest with the agent's ed25519 key",
           `POST to /api/v1/passport/agents/<commitment>/evidence with source_type: "task_deliverable"`,
          "Include the PASSPORT_SERVICE_TOKEN in the Authorization header",
           "Verify the evidence appears at /profiles/<commitment>; a receipt is created only when the evidence bridge is configured",
        ]}
         code={`const payload = {
  task_id: task.id,
  digest: sha256(JSON.stringify(taskResult)),
  observed_at: new Date().toISOString(),
};
const response = await fetch(
  "https://passport.metis.gold/api/v1/passport/agents/" + commitment + "/evidence",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + process.env.PASSPORT_SERVICE_TOKEN,
    },
    body: JSON.stringify({
       source_type: "task_deliverable",
       payload,
       signature: signDigest(
         sha256(canonicalJson(payload)),
         agentPrivateKey,
       ),
    }),
  }
);`}
      />

      <IntegrationCard
        name="Mastra"
        description="Instrument Mastra agent runs to post completion evidence."
        steps={[
          "Add a Passport middleware to your Mastra agent pipeline",
          "On run complete, collect the output and agent identity",
           "POST evidence with source_type derived from the task type and sign sha256(canonicalJson(payload))",
          "Track external_task_id for engagement matching",
        ]}
        code={`// Mastra agent middleware
export const passportMiddleware = (commitment: string) => ({
  onRunComplete: async (result: any) => {
     const payload = {
       task_id: result.taskId,
       digest: sha256(JSON.stringify(result.output)),
       observed_at: new Date().toISOString(),
     };
     await fetch(
      "https://passport.metis.gold/api/v1/passport/agents/" + commitment + "/evidence",
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + process.env.PASSPORT_SERVICE_TOKEN,
        },
        body: JSON.stringify({
          source_type: "task_deliverable",
           payload,
           signature: signDigest(sha256(canonicalJson(payload))),
        }),
      }
    );
  },
});`}
      />

      <IntegrationCard
        name="Claude Code"
        description="Submit receipts from Claude Code sessions via the CLI."
        steps={[
          "After a Claude Code session, extract the completion summary",
          "Sign with the agent's ed25519 key using the CLI helper",
          "POST evidence to Passport",
          "Check the agent profile at /profiles/<commitment>",
        ]}
        code={`#!/usr/bin/env bash
# passport-submit.sh — submit Claude Code session evidence

COMMITMENT="$1"
TASK_ID="$2"
DIGEST="$3"
PAYLOAD=$(printf '{"task_id":"%s","digest":"%s","observed_at":"%s"}' "$TASK_ID" "$DIGEST" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
PAYLOAD_DIGEST=$(printf '%s' "$PAYLOAD" | jq -cS . | sha256sum | cut -d' ' -f1)
SIGNATURE=$(printf '%s' "$PAYLOAD_DIGEST" | ed25519 sign "$AGENT_SECRET_KEY")

curl -X POST "https://passport.metis.gold/api/v1/passport/agents/$COMMITMENT/evidence" \\
  -H "Authorization: Bearer $PASSPORT_SERVICE_TOKEN" \\
  -H "Content-Type: application/json" \\
   -d "{\\"source_type\\":\\"task_deliverable\\",\\"payload\\":$PAYLOAD,\\"signature\\":\\"$SIGNATURE\\"}"`}
      />

      <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-6">
        <h2 className="text-xl font-semibold tracking-tight">Evidence contract</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          Evidence signatures are verified against the raw payload fingerprint, not against the eventual receipt.
          Passport computes <code>sha256(canonicalJson(payload))</code>, where object keys are sorted lexicographically
          and the result is compact JSON. Sign that 64-character lowercase hex digest as UTF-8 with the enrolled agent key.
          The <code>payload</code> field must be a <strong>JSON object</strong> (not a JSON string). If you send a string,
          the digest computation differs and signature verification will fail with 401.
        </p>

        <h3 className="mt-5 text-sm font-semibold">Exact payload schemas (all 6 source types)</h3>
        <div className="mt-3 grid gap-3 text-sm text-slate-700">
          <div className="rounded-lg bg-white p-4">
            <strong className="text-indigo-700">github_commit_payload</strong>
            <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-slate-600">{`{
  sha?: string,              // commit SHA
  html_url?: string,          // link to commit on GitHub
  commit?: {
    message?: string,
    author?: { name?: string, email?: string },
    committer?: { name?: string, email?: string },
  },
  validation_status?: string, // e.g. "pass", "fail"
  check_status?: string,      // e.g. "completed"
  // unknown fields allowed (passthrough)
}`}</pre>
          </div>
          <div className="rounded-lg bg-white p-4">
            <strong className="text-indigo-700">github_push_webhook</strong>
            <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-slate-600">{`{
  ref?: string,               // e.g. "refs/heads/main"
  repository?: {
    full_name?: string,       // e.g. "owner/repo"
    html_url?: string,
  },
  head_commit?: {             // most recent commit
    id?: string, sha?: string, message?: string,
    url?: string, author?: { name?: string, email?: string },
    timestamp?: string, validation_status?: string, check_status?: string,
  },
  commits?: Array<{           // all pushed commits (authoritative when present)
    id?: string, sha?: string, message?: string,
    url?: string, author?: { name?: string, email?: string },
    timestamp?: string, validation_status?: string, check_status?: string,
  }>,
  // unknown fields allowed (passthrough)
}`}</pre>
          </div>
          <div className="rounded-lg bg-white p-4">
            <strong className="text-indigo-700">github_issue_event</strong>
            <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-slate-600">{`{
  agent_identity?: string,    // agent name / identifier
  repository?: string,        // "owner/repo"
  issue?: {
    id?: string,              // issue ID
    number?: number,          // issue number
    url?: string,
    title?: string,
  },
  labels?: string[],          // applied labels
  action?: string,            // "triage_output" | "accept" | "override" | "revert"
  summary?: string,
  transcript_url?: string,
  observed_at?: string,       // ISO-8601
  // unknown fields allowed (passthrough)
}`}</pre>
          </div>
          <div className="rounded-lg bg-white p-4">
            <strong className="text-indigo-700">compliance_report</strong>
            <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-slate-600">{`{
  agent_identity?: string,
  control_domain?: string,    // e.g. "SOC2", "ISO27001"
  report?: {
    id: string,               // report ID (required for ingest)
    url?: string,
    title?: string,
  },
  action?: string,            // "report_created" | "approved" | "rejected"
  transcript_url?: string,
  observed_at?: string,       // ISO-8601
  // unknown fields allowed (passthrough)
}
Note: The report.id field nested under "report" is required.
Fields at the top level like "report_id" will not match.`}</pre>
          </div>
          <div className="rounded-lg bg-white p-4">
            <strong className="text-indigo-700">otel_genai_trace</strong>
            <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-slate-600">{`{
  name?: string,              // span name — must be "invoke_agent" to be ingested
  attributes?: {
    "gen_ai.operation.name"?: string,
    "gen_ai.agent.id"?: string,
    "gen_ai.usage.input_tokens"?: number,
    "gen_ai.usage.output_tokens"?: number,
    "tool.call.count"?: number,
    "validation.status"?: string,
    // any other OTel attributes pass through
  },
  status?: {
    code?: string,            // "OK" | "ERROR" | "UNSET"
    message?: string,
  },
  startTimeUnixNano?: string, // nanosecond epoch
  endTimeUnixNano?: string,
  start_time?: string,        // ISO-8601 fallback
  end_time?: string,          // ISO-8601 fallback
  // unknown fields allowed (passthrough)
}
Note: Only spans with gen_ai.operation.name="invoke_agent"
or name="invoke_agent" are ingested.`}</pre>
          </div>
          <div className="rounded-lg bg-white p-4">
            <strong className="text-indigo-700">task_deliverable</strong>
            <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-slate-600">{`{
  task_id: string,            // required, non-empty — external task identifier
  digest: string,             // required, 64-char hex — SHA-256 of the deliverable output
  observed_at?: string,       // ISO-8601
  // unknown fields allowed (passthrough)
}
How to sign:
  1. Build the object above (task_id + digest + optional observed_at)
  2. Compute digestToSign = sha256(canonicalJson(object))
     where canonicalJson sorts keys lexicographically and produces compact JSON
  3. Sign digestToSign (UTF-8 bytes) with the agent's ed25519 private key
  4. Send the hex signature and the raw payload object (not a string) in the request body`}</pre>
          </div>
        </div>

        <h3 className="mt-5 text-sm font-semibold">How evidence signing works</h3>
        <div className="mt-2 rounded-lg bg-white p-4 text-sm">
          <ol className="ml-4 list-decimal space-y-2 text-slate-700">
            <li><strong>payload</strong> is a JSON object (never a string). The <code>sourceDigest()</code> function computes <code>sha256(canonicalJson(payload))</code> server-side.</li>
            <li>The agent must sign this exact 64-hex digest (as UTF-8 bytes) with its ed25519 key.</li>
            <li>If <code>payload</code> is sent as a JSON <em>string</em>, the server computes <code>sha256(String(payload))</code> instead — a different value from <code>sha256(canonicalJson(parsedObject))</code>. This causes signature mismatch → 401.</li>
            <li>Passport verifies: <code>ed25519.verify(signature, utf8ToBytes(digest), agentPublicKey)</code>.</li>
          </ol>
        </div>

        <p className="mt-4 text-sm text-slate-700">
          <code>task_deliverable</code> also requires <code>Authorization: Bearer &lt;PASSPORT_SERVICE_TOKEN&gt;</code> when
          <code>EVIDENCE_SERVICE_AUTH_REQUIRED=true</code>. Other source types use the enrolled agent signature only.
        </p>
      </section>

      <IntegrationCard
        name="Custom Agent"
        description="Any agent framework can integrate with Passport."
        steps={[
          "Agent generates an ed25519 keypair at startup",
          "Enroll via POST /enroll/start → /enroll/complete",
          "On task completion, issue a receipt via POST /receipts",
          "Finalize with the outcome via POST /receipts/:id/finalize",
          "Anyone verifies at /verify/:id",
        ]}
        code={`// Minimal integration pseudocode
const passport = new PassportClient({
  apiKey: process.env.PASSPORT_API_KEY,
  baseUrl: "https://passport.metis.gold",
});

// Enroll agent
const { subjectCommitment } = await passport.enroll(agentPublicKey);

// On task complete
const receipt = await passport.issueReceipt({
  agentId: agent.id,
  type: "competence",
  inputDigest: sha256(input),
  domain: "CODE_GENERATION",
});

await passport.finalizeReceipt(receipt.id, {
  status: "success",
  outputHash: sha256(output),
});

// Return receipt URL for verification
return \`https://passport.metis.gold/verify/\${receipt.id}\`;`}
      />

      <div className="rounded-lg border-l-4 border-indigo-500 bg-indigo-50 p-4 text-sm text-indigo-900">
        <strong>Want a specific integration?</strong> The API is designed to be
        framework-agnostic. If your framework isn&apos;t listed, the REST API
        works with any HTTP client.{" "}
        <Link href="/docs/api-reference" className="underline">
          See the full API Reference →
        </Link>
      </div>
    </div>
  );
}

function IntegrationCard({
  name,
  description,
  steps,
  code,
}: {
  name: string;
  description: string;
  steps: string[];
  code: string;
}) {
  return (
    <section className="rounded-xl border p-6">
      <h2 className="text-xl font-semibold tracking-tight">{name}</h2>
      <p className="mt-1 text-sm text-slate-600">{description}</p>

      <h3 className="mt-4 text-sm font-semibold">Steps</h3>
      <ol className="mt-2 space-y-1.5 text-sm text-slate-600">
        {steps.map((s, i) => (
          <li key={i}>
            <span className="mr-1.5 font-medium text-indigo-600">{i + 1}.</span>
            {s}
          </li>
        ))}
      </ol>

      <h3 className="mt-4 text-sm font-semibold">Example</h3>
      <pre className="mt-2 overflow-x-auto rounded-lg border bg-slate-950 p-4 text-sm text-slate-200">
        <code>{code}</code>
      </pre>
    </section>
  );
}
