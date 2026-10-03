"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

/**
 * "Sign in with Passport" — owner consent page (browser hand-off).
 *
 * A relying app redirects the accountable human here when an agent cannot
 * complete a headless sign-in. The owner reviews which agent is signing in, to
 * which app, and which scopes (including disclosure of their own email), then
 * approves. We show the EXACT agent and audience so consent is informed.
 */
function ConsentInner() {
  const params = useSearchParams();
  const agentCommitment = params.get("agent_commitment") || "";
  const audience = params.get("audience") || "";
  const [requestOwnerEmail, setRequestOwnerEmail] = useState(true);
  const [state, setState] = useState<"idle" | "loading" | "approved" | "error">("idle");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  async function approve() {
    setState("loading");
    setError("");
    try {
      const r = await fetch("/api/v1/agent-identity/authorize/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_commitment: agentCommitment,
          audience,
          requested_scopes: ["openid", ...(requestOwnerEmail ? ["owner_email"] : [])],
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setState("error");
        setError(j.error || `HTTP ${r.status}`);
        return;
      }
      setCode(j.code || "");
      setState("approved");
      // If the relying app supplied a redirect, hand the code back.
      const redirect = params.get("redirect_uri");
      if (redirect) {
        const u = new URL(redirect);
        u.searchParams.set("code", j.code);
        window.location.assign(u.toString());
      }
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  if (!agentCommitment || !audience) {
    return <p className="text-red-600 text-sm">Missing agent_commitment or audience in the request.</p>;
  }

  return (
    <div className="rounded-xl border bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold">An agent wants to sign in to {audience}</h1>
      <p className="mt-2 text-sm text-slate-600">
        Approve to let this agent authenticate as itself. The app will recognize it again
        and can revoke it without affecting your account.
      </p>
      <dl className="mt-4 space-y-1 text-xs">
        <div className="flex gap-2"><dt className="text-slate-500 w-32">Agent (subject)</dt><dd className="font-mono break-all">{agentCommitment}</dd></div>
        <div className="flex gap-2"><dt className="text-slate-500 w-32">Requesting app</dt><dd className="font-mono break-all">{audience}</dd></div>
      </dl>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={requestOwnerEmail} onChange={(e) => setRequestOwnerEmail(e.target.checked)} />
        Share my email with this app as the accountable owner
      </label>
      {state === "error" && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {state === "approved" ? (
        <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          Approved. Authorization code: <span className="font-mono">{code}</span>
        </div>
      ) : (
        <div className="mt-5 flex gap-3">
          <button
            onClick={approve}
            disabled={state === "loading"}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {state === "loading" ? "Approving…" : "Approve sign-in"}
          </button>
          <Link href="/" className="rounded-lg border px-4 py-2 text-sm">Cancel</Link>
        </div>
      )}
    </div>
  );
}

export default function AgentAuthorizePage() {
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <ConsentInner />
    </main>
  );
}
