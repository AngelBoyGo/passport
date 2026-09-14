import Link from "next/link";

export const metadata = {
  title: "Economy Health Dashboard",
  description:
    "Signed system-health barometer for the Passport agent economy: revenue, reserves, integrity, and governance in a single view.",
};

export default function DocsEconomyHealth() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Economy Health Dashboard</h1>
        <p className="mt-2 text-slate-600">
          A signed, self-contained health snapshot that the Command Brain and external verifiers
          can consume as a single source of truth about economic system health.
        </p>
      </div>

      <section>
        <h2 className="text-xl font-semibold">Endpoint</h2>
        <p className="mt-1 text-sm text-slate-600">
          <code className="font-mono text-xs">GET /api/v1/agents/economy-health</code> — no auth.
          Returns a signed JSON object with the current health score and its components.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">What it measures</h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-slate-500">
              <th className="pb-1 pr-4">Field</th>
              <th className="pb-1">Meaning</th>
            </tr>
          </thead>
          <tbody className="text-slate-600">
            <tr className="border-b">
              <td className="py-2 pr-4 font-mono text-xs">reserve_adequate</td>
              <td>True when the reserve coverage ratio is ≥ 1.0</td>
            </tr>
            <tr className="border-b">
              <td className="py-2 pr-4 font-mono text-xs">total_reserve_usd</td>
              <td>Aggregate commodity reserve value in USD</td>
            </tr>
            <tr className="border-b">
              <td className="py-2 pr-4 font-mono text-xs">total_supply_angel</td>
              <td>Outstanding ANGEL in wallets + escrow</td>
            </tr>
            <tr className="border-b">
              <td className="py-2 pr-4 font-mono text-xs">coverage_ratio</td>
              <td>reserve / supply (should be ≥ 1)</td>
            </tr>
            <tr className="border-b">
              <td className="py-2 pr-4 font-mono text-xs">gross_revenue_usd</td>
              <td>Trailing 30d revenue from agent economy fees</td>
            </tr>
            <tr className="border-b">
              <td className="py-2 pr-4 font-mono text-xs">open_disputes</td>
              <td>Count of unresolved compute purchase disputes</td>
            </tr>
            <tr className="border-b">
              <td className="py-2 pr-4 font-mono text-xs">brain_health_score</td>
              <td>Composite 0–1 reflecting reserve adequacy, integrity, and dispute load</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Signing</h2>
        <p className="mt-1 text-sm text-slate-600">
          The response carries an Ed25519 signature over the canonical JSON of the health payload,
          signed by the Passport signing key (<code className="font-mono text-xs">SIGNING_PRIVATE_KEY</code>).
          Verify offline with the corresponding public key from{" "}
          <code className="font-mono text-xs">GET /api/v1/verify/public-key</code>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Integration</h2>
        <p className="mt-1 text-sm text-slate-600">
          The Command Brain consumes the health dashboard each cycle (see{" "}
          <Link className="text-indigo-600 underline" href="/docs/command-brain">
            Command Brain
          </Link>
          ). External tools may poll the endpoint and verify the signature to build monitoring,
          alerts, or compliance attestations.
        </p>
      </section>
    </div>
  );
}