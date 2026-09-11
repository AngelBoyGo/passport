import Link from "next/link";

export const metadata = {
  title: "Economic Resilience Report — survivability under attack",
  description:
    "How to read Passport's Economic Resilience Report: adversarial scenario stress-tests (redemption run, oracle skew, reserve shortfall, Sybil wash), the invariants they assert, and how to verify the signed snapshot offline.",
};

export default function DocsResilience() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Economic Resilience Report</h1>
        <p className="mt-2 text-slate-600">
          The integrity attestation proves the <em>current</em> state is conserved. The Resilience
          Report asks the harder question: does the economy <strong>survive adversarial
          conditions</strong> with its sacred invariants intact? It applies modeled shocks to a
          live baseline snapshot and reports where — if ever — each one breaks.
        </p>
      </div>

      <section>
        <h2 className="text-xl font-semibold">The scenarios</h2>
        <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
          <li>
            <strong>redemption_run</strong> — a correlated fraction of circulating supply redeems
            at <code className="font-mono text-xs">P_red = P × (1 − σ)</code>; asserts reserve
            coverage <code className="font-mono text-xs">R ≥ ρ·S·P_red</code> at every step
            (25 / 50 / 75 / 100%).
          </li>
          <li>
            <strong>oracle_skew</strong> — commodity spot moves by the documented set (adversity
            increasing); asserts USD reserve + commodity collateral covers{" "}
            <code className="font-mono text-xs">ρ·liabilities</code> and no pool is emptied.
          </li>
          <li>
            <strong>reserve_shortfall</strong> — reserve units are removed in 1 / 5 / 10% steps
            (theft, assay failure); asserts ANGEL stays backed or flags under-collateralization.
          </li>
          <li>
            <strong>sybil_wash</strong> — a settlement burst measured against the velocity
            tripwire; &ldquo;survives&rdquo; means the tripwire detects it and auto-quarantine
            contains it. The report also documents the residual <em>undetected</em> capacity
            below the tripwire.
          </li>
        </ul>
        <p className="text-sm text-slate-600 mt-2">
          Every magnitude is an exported constant and is echoed back in{" "}
          <code className="font-mono text-xs">resilience.inputs</code>, so the report is fully
          reproducible. It reuses the canonical monetary formulas and the Phase-22 velocity
          constants — no new money math.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Severity</h2>
        <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
          <li>
            <strong className="text-red-600">SEVERE</strong> — a scenario failed; the response
            names the <code className="font-mono text-xs">worst_scenario</code> and is never
            cached.
          </li>
          <li>
            <strong className="text-amber-600">WARNING</strong> — all scenarios survive but the
            redemption-coverage buffer is thin (&lt; 1.25× liabilities); never cached.
          </li>
          <li>
            <strong className="text-emerald-600">OK</strong> — the economy survives every scenario
            with a healthy buffer.
          </li>
        </ul>
        <pre className="mt-3 rounded-lg bg-slate-900 p-4 text-xs text-slate-100 overflow-x-auto">{`GET /api/v1/raillab/resilience   (ISSUER API key)
{
  "resilience": {
    "baseline": { "angel_supply": 100000, "reserve_usd": 675000, "backing_ratio": 1.5, ... },
    "scenarios": [
      { "scenario": "redemption_run", "survives": true, "worst_case": "fully backed at 100% redemption", "detail": [...] },
      { "scenario": "oracle_skew", "survives": true, ... },
      { "scenario": "reserve_shortfall", "survives": true, ... },
      { "scenario": "sybil_wash", "survives": true, ... }
    ],
    "summary": { "survives": true, "worst_scenario": null, "severity": "OK" },
    "inputs": { "redemption_stress_steps": [0.25, 0.5, 0.75, 1], ... },
    "degraded": false
  },
  "snapshot": { "content_hash": "…", "signature": "…", "public_key": "…", "algorithm": "ed25519" }
}`}</pre>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Verify the report offline</h2>
        <p className="text-sm text-slate-600 mt-2">
          Signed with the same key as{" "}
          <Link className="text-indigo-600 underline" href="/api/v1/receipts/monetary">
            /api/v1/receipts/monetary
          </Link>
          . Remove <code className="font-mono text-xs">snapshot</code>, recompute{" "}
          <code className="font-mono text-xs">sha256(canonicalJson(body, keys sorted))</code>, then
          verify the Ed25519 signature over <code className="font-mono text-xs">utf8(content_hash)</code>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Agent autarky</h2>
        <pre className="mt-3 rounded-lg bg-slate-900 p-4 text-xs text-slate-100 overflow-x-auto">{`const p = new PassportClient({ apiKey: "pp_…", baseUrl: "https://passport.metis.gold" });
const r = await p.getResilience();               // ISSUER key

if (r.resilience.summary.severity === "SEVERE") {
  // an autonomous operator can halt work / demand remediation before touching the rails.
}`}</pre>
      </section>
    </div>
  );
}
