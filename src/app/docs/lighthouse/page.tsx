import Link from "next/link";

export const metadata = {
  title: "Adoption Lighthouse — a verifiable barometer of organic uptake",
  description:
    "How to read Passport's Adoption Lighthouse: organic adoption counts and 24h/7d trends, how self-generated rows are excluded, and how to verify the signed snapshot offline.",
};

export default function DocsLighthouse() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Adoption Lighthouse</h1>
        <p className="mt-2 text-slate-600">
          The Trust Console answers &ldquo;is the system safe?&rdquo;. The Adoption Lighthouse
          answers a different question: <strong>is anyone actually using it — and is that
          growing?</strong> It aggregates enrollments, evidence, receipts, settlements, and
          enabled rails across time windows, reports the <em>trajectory</em>, and signs the
          result so anyone can verify the numbers.
        </p>
      </div>

      <section>
        <h2 className="text-xl font-semibold">It refuses to flatter us</h2>
        <p className="text-sm text-slate-600 mt-2">
          Our own smoke harnesses and the adoption proof loop create agents, evidence, receipts,
          rails, and settlements. Counting those as &ldquo;adoption&rdquo; would be
          self-congratulatory. Any row whose identity / evidence / reference carries one of the
          documented markers is excluded, and the marker list is returned in the response under{" "}
          <code className="font-mono text-xs">excluded_markers</code>:
        </p>
        <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
          <li><code className="font-mono text-xs">adopt-</code> — the adoption proof loop and its canary rail</li>
          <li><code className="font-mono text-xs">adopt-canary-</code> — the settlement canary rail</li>
          <li><code className="font-mono text-xs">smoke:</code> — smoke-harness artifacts</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Buckets and trend</h2>
        <p className="text-sm text-slate-600 mt-2">
          Four buckets — <code className="font-mono text-xs">24h</code>,{" "}
          <code className="font-mono text-xs">7d</code>,{" "}
          <code className="font-mono text-xs">30d</code>,{" "}
          <code className="font-mono text-xs">all</code> — each report{" "}
          <code className="font-mono text-xs">enrolled_agents</code>,{" "}
          <code className="font-mono text-xs">evidence_events</code>,{" "}
          <code className="font-mono text-xs">receipts</code>,{" "}
          <code className="font-mono text-xs">settlements</code>,{" "}
          <code className="font-mono text-xs">enabled_rails</code>, and{" "}
          <code className="font-mono text-xs">distinct_operator_prefixes</code>. For the 24h and
          7d windows the lighthouse also compares against the <em>equal preceding window</em> and
          labels each metric <code className="font-mono text-xs">growing</code>,{" "}
          <code className="font-mono text-xs">flat</code>, or{" "}
          <code className="font-mono text-xs">falling</code>.
        </p>
        <p className="text-sm text-slate-600 mt-2">
          Operator ids are masked to their first four characters — a count of distinct operators,
          never an identity.
        </p>
        <pre className="mt-3 rounded-lg bg-slate-900 p-4 text-xs text-slate-100 overflow-x-auto">{`GET /api/v1/raillab/lighthouse   (ISSUER API key)
{
  "lighthouse": {
    "organic_only": true,
    "excluded_markers": ["adopt-", "adopt-canary-", "smoke:"],
    "buckets": { "24h": { "enrolled_agents": 3, "settlements": 41, ... }, "7d": {...}, "30d": {...}, "all": {...} },
    "trend":   { "24h": { "settlements": "growing", ... }, "7d": {...} },
    "degraded": false,
    "degraded_reasons": []
  },
  "snapshot": { "content_hash": "…", "signature": "…", "public_key": "…", "algorithm": "ed25519" }
}`}</pre>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Verify the numbers offline</h2>
        <p className="text-sm text-slate-600 mt-2">
          The response is signed with the same key as{" "}
          <Link className="text-indigo-600 underline" href="/api/v1/receipts/monetary">
            /api/v1/receipts/monetary
          </Link>
          . Remove the <code className="font-mono text-xs">snapshot</code> object, recompute{" "}
          <code className="font-mono text-xs">
            content_hash = sha256(canonicalJson(body, keys sorted))
          </code>
          , then verify the Ed25519 signature over <code className="font-mono text-xs">utf8(content_hash)</code>.
          If it checks out, the adoption numbers were not tampered with in transit or at rest.
        </p>
        <pre className="mt-3 rounded-lg bg-slate-900 p-4 text-xs text-slate-100 overflow-x-auto">{`# pseudocode
body      = response minus "snapshot"
hash      = sha256(canonicalJson(body))
assert hash == snapshot.content_hash
assert ed25519_verify(snapshot.signature, utf8(hash), snapshot.public_key)`}</pre>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Degrades, never lies</h2>
        <p className="text-sm text-slate-600 mt-2">
          If a datastore read fails, the lighthouse returns HTTP 200 with{" "}
          <code className="font-mono text-xs">degraded: true</code>, the buckets it could compute,
          and a <code className="font-mono text-xs">degraded_reasons</code> list — a barometer
          that hides all data on a partial outage is worse than one that reports what it sees.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Agent autarky</h2>
        <pre className="mt-3 rounded-lg bg-slate-900 p-4 text-xs text-slate-100 overflow-x-auto">{`const p = new PassportClient({ apiKey: "pp_…", baseUrl: "https://passport.metis.gold" });
const lh = await p.getLighthouse();              // ISSUER key

if (lh.lighthouse.buckets["7d"].settlements === 0 || lh.lighthouse.trend["7d"].settlements === "falling") {
  // an autonomous operator can notice the network is cooling and adjust.
}`}</pre>
      </section>
    </div>
  );
}
