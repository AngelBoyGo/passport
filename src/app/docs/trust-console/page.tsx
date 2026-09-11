import Link from "next/link";

export const metadata = {
  title: "Operational Trust Console — visible assurance",
  description:
    "How to read Passport's Operational Trust Console: safety interlock status, the signed attestation chain, and how to independently verify an attestation hash + signature.",
};

export default function DocsTrustConsole() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Operational Trust Console</h1>
        <p className="mt-2 text-slate-600">
          Passport continuously attests that its money ledgers stayed conserved. The Trust
          Console surfaces that attestation (signed, chained, offline-verifiable) together with
          the execution-safety interlock and rail health — so operators and autonomous agents can
          see — and independently verify — the current trust state.
        </p>
      </div>

      <section>
        <h2 className="text-xl font-semibold">Reading the dashboard</h2>
        <p className="text-sm text-slate-600 mt-2">Three severity tilts make it legible:</p>
        <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
          <li>
            <strong className="text-red-600">SEVERE</strong> — the execution interlock is ON
            (live settlement halted after an integrity breach) OR the attestation chain failed
            verification. Treat as: stop transacting; investigate immediately.
          </li>
          <li>
            <strong className="text-amber-600">WARNING</strong> — a settlement-velocity anomaly
            (possible compromised signer) OR stale PENDING/PENDING_REVIEW settlements. Treat as:
            investigate; the AUTO-QUARANTINE tripwire may already be acting.
          </li>
          <li>
            <strong className="text-emerald-600">OK</strong> — ledgers conserved, chain verified,
            interlock clear.
          </li>
        </ul>
        <pre className="mt-3 rounded-lg bg-slate-900 p-4 text-xs text-slate-100 overflow-x-auto">{`GET /api/v1/raillab/console   (ISSUER API key)
{
  "console": {
    "severity": "OK",
    "safety": { "halted": false, ... },
    "attestation": { "verified": true, "chain_ok": true, "issues": [] },
    "rails": { "total": 12, "enabled": 9, "quarantined": 1, ... }
  }
}`}</pre>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Independently verify an attestation</h2>
        <p className="text-sm text-slate-600 mt-2">
          You don&apos;t have to trust the dashboard. Fetch the latest signed attestation and verify it
          in two steps — recompute the hash and check the Ed25519 signature:
        </p>
        <pre className="mt-3 rounded-lg bg-slate-900 p-4 text-xs text-slate-100 overflow-x-auto">{`GET /api/v1/raillab/health/attestations/latest   (public)

# verify endpoint (public) — POST the full attestation object
POST /api/v1/raillab/health/attestations/verify

# or verify POST /api/v1/raillab/health/attestations/verify
# with the full signed attestation JSON body -> { "valid": true }`}</pre>
        <p className="text-sm text-slate-600 mt-2">
          The attestation <code className="font-mono text-xs">attestation_hash</code> is
          <code className="font-mono text-xs">sha256(canonicalJson(body))</code>; the Ed25519
          signature is over that hash. `chain_ok` means the previous hash resolves to a stored
          attestation, making the whole history tamper-evident.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Live status endpoints (public)</h2>
        <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
          <li>
            <Link className="text-indigo-600 underline" href="/api/v1/raillab/health/safety">
              /api/v1/raillab/health/safety
            </Link>{" "}
            — execution interlock (never cached).
          </li>
          <li>
            <Link className="text-indigo-600 underline" href="/api/v1/raillab/health/attestations/latest">
              /api/v1/raillab/health/attestations/latest
            </Link>{" "}
            — latest signed attestation.
          </li>
          <li>
            <Link className="text-indigo-600 underline" href="/api/v1/raillab/health/attestations/verify">
              /api/v1/raillab/health/attestations/verify
            </Link>{" "}
            — offline verification.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Agent autarky</h2>
        <p className="text-sm text-slate-600 mt-2">
          From the SDK:
        </p>
        <pre className="mt-3 rounded-lg bg-slate-900 p-4 text-xs text-slate-100 overflow-x-auto">{`const p = new PassportClient({ apiKey: "pp_…", baseUrl: "https://passport.metis.gold" });
const safety = await p.getSafetyStatus();       // public
const trust  = await p.getTrustOverview();      // ISSUER key for full detail

if (trust.console.severity === "SEVERE") {
  // An autonomous agent can decide to pause work on this rail.
}`}</pre>
      </section>
    </div>
  );
}