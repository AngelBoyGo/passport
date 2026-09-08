import Link from "next/link";

export const metadata = {
  title: "Passport SDK — Free MIT TypeScript & Python clients",
  description:
    "Real documentation for @passport7/sdk (TypeScript) and passport-sdk (Python): install, quickstart, LangChain/Mastra/Vercel-AI hooks, and the Sovereign Haven RWA clients.",
};

export default function DocsSdk() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Passport SDK</h1>
        <p className="mt-2 text-slate-600">
          Official, free, MIT-licensed clients. No payment required for the core protocol,
          the SDK, or receipt verification.
        </p>
      </div>

      <div className="rounded-lg border-l-4 border-emerald-500 bg-emerald-50 p-4 text-sm text-emerald-900">
        <strong>Open source & free:</strong> TypeScript <code className="font-mono text-xs">@passport7/sdk</code>{" "}
        and Python <code className="font-mono text-xs">passport-sdk</code>. Install — don&apos;t pay.
      </div>

      <section>
        <h2 className="text-xl font-semibold">TypeScript — install</h2>
        <pre className="mt-2 rounded-lg bg-slate-900 p-4 text-xs text-slate-100 overflow-x-auto">{`npm install @passport7/sdk`}</pre>
        <pre className="mt-2 rounded-lg bg-slate-900 p-4 text-xs text-slate-100 overflow-x-auto">{`import { PassportClient } from "@passport7/sdk";

const p = new PassportClient({
  apiKey: "pp_…",                 // free developer tier from /dashboard
  baseUrl: "https://passport.metis.gold",
});

// Issue a signed receipt for agent work
const r = await p.issueReceipt({
  agent_id: "agent_fulfillment_1",
  receipt_type: "competence",
  input_digest: "<sha256 hex>",
  authority_scope: "fulfillment.example.com",
  expiry: "2026-08-01T00:00:00.000Z",
});

await p.finalizeReceipt(r.receipt_id, {
  status: "success",
  output_hash: "<sha256 hex>",
});`}</pre>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Framework hooks</h2>
        <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
          <li>
            <strong>LangChain:</strong>{" "}
            <code className="font-mono text-xs">@passport7/sdk/langchain</code> —{" "}
            <code className="font-mono text-xs">PassportCallbackHandler</code> posts OTel evidence on every LLM call.
          </li>
          <li>
            <strong>Mastra:</strong>{" "}
            <code className="font-mono text-xs">@passport7/sdk/mastra</code> —{" "}
            <code className="font-mono text-xs">createMastraPassportMiddleware</code> anchors every agent/workflow run with a receipt.
          </li>
          <li>
            <strong>Vercel AI:</strong>{" "}
            <code className="font-mono text-xs">@passport7/sdk/vercel-ai</code> —{" "}
            <code className="font-mono text-xs">passportMiddleware</code> gates + audits LLM calls.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Sovereign Haven / RWA clients</h2>
        <p className="text-sm text-slate-600">
          The SDK bundles typed clients for the reserve stack — all free, protocol-level:
        </p>
        <pre className="mt-2 rounded-lg bg-slate-900 p-4 text-xs text-slate-100 overflow-x-auto">{`const por      = await p.reserves.getPoR({ commodity: "GOLD" });
const regime   = await p.reserves.getRegimeState();
const escrow   = await p.reservesEscrow.createCommodityEscrow({ ... });
const intake   = await p.artisanal.intakeOre({ ... });
const proposal = await p.quorum.proposeQuorum({ ... });
const waybill  = await p.transit.dispatch({ ... });
const run      = await p.industrial.recordSmelting({ ... });
const project  = await p.fund.registerProject({ ... });`}</pre>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Python — stdlib only</h2>
        <pre className="mt-2 rounded-lg bg-slate-900 p-4 text-xs text-slate-100 overflow-x-auto">{`from passport_sdk import PassportClient

p = PassportClient(api_key="pp_…", base_url="https://passport.metis.gold")
receipt = p.issue_receipt(
    agent_id="agent_1", receipt_type="competence",
    input_digest="<sha256 hex>",
    authority_scope="example.com",
    expiry="2026-08-01T00:00:00.000Z",
)
p.finalize_receipt(receipt["receipt_id"], status="success", output_hash="<sha256 hex>")`}</pre>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Verification is public & keyless</h2>
        <p className="text-sm text-slate-600">
          Anyone can verify a receipt with no auth:
        </p>
        <pre className="mt-2 rounded-lg bg-slate-900 p-4 text-xs text-slate-100 overflow-x-auto">{`GET /api/v1/receipts/{id}/public-manifest
GET /api/v1/public-key`}</pre>
      </section>

      <section>
        <h2 className="text-xl font-semibold">More</h2>
        <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
          <li><Link className="text-indigo-600 underline" href="/docs/getting-started">Getting started</Link></li>
          <li><Link className="text-indigo-600 underline" href="/docs/api-reference">API reference</Link></li>
          <li><Link className="text-indigo-600 underline" href="/docs/integrations">Integrations</Link></li>
          <li><Link className="text-indigo-600 underline" href="/llms.txt">llms.txt</Link></li>
          <li>
            npm:{" "}
            <a className="text-indigo-600 underline" href="https://www.npmjs.com/package/@passport7/sdk">
              @passport7/sdk
            </a>
          </li>
        </ul>
      </section>
    </div>
  );
}