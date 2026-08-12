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
        </p>
        <div className="mt-4 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
          <div className="rounded-lg bg-white p-4"><strong>task_deliverable</strong><br />{`{ task_id: string, digest: 64-hex, observed_at?: ISO-8601 }`}</div>
          <div className="rounded-lg bg-white p-4"><strong>compliance_report</strong><br />{`{ report: { id: string, url?: string }, agent_identity?: string, control_domain?: string, action?: string, observed_at?: ISO-8601 }`}</div>
          <div className="rounded-lg bg-white p-4"><strong>otel_genai_trace</strong><br />{`{ name?: string, attributes?: object, status?: object, start_time?: string, end_time?: string }`}</div>
          <div className="rounded-lg bg-white p-4"><strong>GitHub sources</strong><br />Use the GitHub push, commit, or issue payload shape documented by the corresponding webhook adapter.</div>
        </div>
        <p className="mt-4 text-sm text-slate-700">
          <code>task_deliverable</code> also requires <code>Authorization: Bearer PASSPORT_SERVICE_TOKEN</code> when
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
