import Link from "next/link";

export const metadata = {
  title: "Command Brain",
  description: "Scope, features, actions, memory, and guardrails of the central AI supervisor.",
};

const FEATURES = [
  ["Bounded action space", "An explicit allowlist (NOOP / RECORD_NOTE / RUN_DISCOVERY / RUN_TICK / TRIGGER_ATTESTATION / QUARANTINE_RAIL / INVESTIGATE_DISPUTE). Anything else resolves to NOOP."],
  ["Observability", "A single datapoint snapshot each cycle — economy health, integrity, rails, disputes, and a composite health score."],
  ["Persistence", "Append-only BrainMemory table: each cycle writes OBSERVATION, DECISION, and OUTCOME rows."],
  ["Playbook learning", "Per-action success rates calculated from OUTCOME rows; the prompt tells the model which actions have actually worked."],
  ["Fail-closed", "LLM or transport failure => NOOP. The brain never guesses an action."],
  ["Guardrails", "No money-moving action is ever in the allowlist. Rate-limited. ISSUER/scheduler auth required."],
];

export default function DocsCommandBrain() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Command Brain</h1>
        <p className="mt-2 text-slate-600">
          The central AI supervisor for the Passport / AngelCoin / agent economy. Each cycle it
          observes the whole system, decides exactly <strong>one</strong> bounded action, records
          what it did, and conditions on its own history. It is deliberately constrained —
          it can never move money.
        </p>
      </div>

      <section>
        <h2 className="text-xl font-semibold">What it manages safely</h2>
        <table className="mt-2 w-full text-sm">
          <thead><tr className="border-b text-left text-slate-500"><th className="pb-1 pr-4">Domain</th><th className="pb-1 pr-4">Manageable?</th><th className="pb-1">Why</th></tr></thead>
          <tbody className="text-slate-600">
            <tr className="border-b"><td className="py-1 pr-4">Rail health</td><td className="py-1 pr-4">OK</td><td className="py-1">quarantine a failing rail — reversible, audited</td></tr>
            <tr className="border-b"><td className="py-1 pr-4">Discovery cadence</td><td className="py-1 pr-4">OK</td><td className="py-1">trigger /discover when stale — idempotent</td></tr>
            <tr className="border-b"><td className="py-1 pr-4">Execution cadence</td><td className="py-1 pr-4">OK</td><td className="py-1">run /tick (dry-run only) — never moves money</td></tr>
            <tr className="border-b"><td className="py-1 pr-4">Integrity</td><td className="py-1 pr-4">OK</td><td className="py-1">trigger attestation — append-only evidence</td></tr>
            <tr className="border-b"><td className="py-1 pr-4">Disputes</td><td className="py-1 pr-4">Advisory</td><td className="py-1">flag for attention; jurors decide, not the brain</td></tr>
            <tr className="border-b"><td className="py-1 pr-4">Money movement</td><td className="py-1 pr-4">NEVER</td><td className="py-1">only /settle + reserve services may move value</td></tr>
            <tr className="border-b"><td className="py-1 pr-4">Key custody / interlock</td><td className="py-1 pr-4">NEVER</td><td className="py-1">human/ISSUER-only</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Features</h2>
        <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
          {FEATURES.map(([label, desc]) => (
            <li key={label}><strong>{label}:</strong> {desc}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Datapoints fed each cycle</h2>
        <p className="mt-1 text-sm text-slate-600">
          From <code className="font-mono text-xs">gatherDatapoints()</code>: economy health
          (supply, reserve, coverage, external-revenue share, velocity, disputes, verifications,
          capabilities, offers, pipeline jobs), integrity status+issues, rail counts
          (enabled/quarantined), open disputes, and a composite <code className="font-mono text-xs">health_score</code>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Endpoints</h2>
        <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
          <li><code className="font-mono text-xs">POST /api/v1/raillab/brain/cycle</code> — run one cycle (ISSUER key or <code className="font-mono text-xs">x-scheduler-secret</code>)</li>
          <li><code className="font-mono text-xs">GET /api/v1/raillab/brain/memory</code> — recent brain memory</li>
        </ul>
        <p className="mt-2 text-sm text-slate-600">
          The brain now runs on a configurable cron cadence via the scheduler. Set <code className="font-mono text-xs">BRAIN_SCHEDULE</code> env
          (default <code className="font-mono text-xs">*/10 * * * *</code> = every 10 minutes).
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Guardrails (never-do)</h2>
        <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
          <li>Never mint, burn, transfer, settle, or redeem.</li>
          <li>Never clear the execution-safety interlock.</li>
          <li>Never touch signer/operator keys.</li>
          <li>Never act outside the allowlist; unknown proposals resolve to NOOP.</li>
          <li>Never act on an LLM failure — fail closed.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Related</h2>
        <p className="text-sm text-slate-600">
          <Link className="text-indigo-600 underline" href="/docs/economy-health">Economy Health Dashboard</Link>
        </p>
      </section>
    </div>
  );
}