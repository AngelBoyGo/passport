import Link from "next/link";

export const metadata = {
  title: "Fail-Closed System Posture — one honest answer",
  description:
    "How to read Passport's Fail-Closed System Posture & Readiness: one signed severity composed from every assurance surface, plus a deployment readiness check, and how to verify it offline.",
};

export default function DocsPosture() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Fail-Closed System Posture</h1>
        <p className="mt-2 text-slate-600">
          Every assurance surface answers its own question. The Posture answers the only one an
          operator truly needs: <strong>is everything trustworthy <em>and</em> correctly
          configured, right now?</strong> It composes attestation, the safety interlock, the Trust
          Console, the Adoption Lighthouse, and the Resilience Report into one signed severity —
          and adds a readiness check of the deployment itself.
        </p>
      </div>

      <section>
        <h2 className="text-xl font-semibold">Fail-closed by construction</h2>
        <p className="text-sm text-slate-600 mt-2">
          Silent degradation is the enemy. The Posture enforces one invariant:{" "}
          <strong>any unreadable or unconfigured source forces severity ≥{" "}
          <code className="font-mono text-xs">WARNING</code></strong>, and any hard failure — a
          halted interlock, an unverified attestation chain, a suspicious Lighthouse, a degraded
          Resilience report, or a readiness blocker — forces{" "}
          <code className="font-mono text-xs">SEVERE</code>. A source that times out is reported as
          degraded, never mistaken for healthy.
        </p>
        <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
          <li>Every source is probed <strong>in parallel with a per-source timeout</strong>, so one slow dependency cannot hang the report.</li>
          <li>Readiness checks required env, signing-key validity, scheduler-secret presence (production), database reachability, and applied migrations — <strong>never emitting a secret value</strong>.</li>
        </ul>
        <pre className="mt-3 rounded-lg bg-slate-900 p-4 text-xs text-slate-100 overflow-x-auto">{`GET /api/v1/raillab/posture   (ISSUER API key)
{
  "posture": {
    "severity": "OK",
    "ready": true,
    "surfaces": {
      "attestation": { "verified": true, "chain_ok": true },
      "safety": { "halted": false, "reason": null },
      "console": { "severity": "OK", "degraded": false },
      "lighthouse": { "degraded": false, "suspicious": false },
      "resilience": { "severity": "OK", "survives": true }
    },
    "checks": [
      { "name": "required_env", "ok": true, "blocking": true, "detail": "all required env present" },
      { "name": "signing_key", "ok": true, "blocking": true, "detail": "valid ed25519 private key" },
      { "name": "database", "ok": true, "blocking": true, "detail": "reachable" }
    ],
    "blockers": [],
    "degraded": false,
    "degraded_reasons": []
  },
  "snapshot": { "content_hash": "…", "signature": "…", "public_key": "…", "algorithm": "ed25519" }
}`}</pre>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Severity</h2>
        <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
          <li><strong className="text-red-600">SEVERE</strong> — a hard assurance failure or a readiness blocker. Never cached.</li>
          <li><strong className="text-amber-600">WARNING</strong> — a readable-but-degraded source, or an unreadable one. Never cached.</li>
          <li><strong className="text-emerald-600">OK</strong> — every surface healthy and the deployment ready; cached for 60s, privately.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Verify it offline</h2>
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
const { posture } = await p.getPosture();       // ISSUER key

if (!posture.ready || posture.severity !== "OK") {
  // halt autonomous work until the posture is green; inspect posture.blockers / degraded_reasons.
}`}</pre>
      </section>
    </div>
  );
}
