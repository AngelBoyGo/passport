"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

const SAMPLE_PAYLOADS: Record<string, Record<string, unknown>> = {
  github_commit_payload: { sha: "abc123def456", html_url: "https://github.com/owner/repo/commit/abc123", commit: { message: "feat: add passport integration", author: { name: "Agent" } } },
  compliance_report: { report_id: "soc2-2026-q3", control_domain: "SOC2", report: { id: "soc2-2026-q3", title: "SOC2 Type II Report" }, action: "report_created" },
  otel_genai_trace: { name: "invoke_agent", attributes: { "gen_ai.operation.name": "invoke_agent", "gen_ai.agent.id": "agent-001" }, status: { code: "OK" } },
  task_deliverable: { task_id: "task-001", digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
  github_issue_event: { agent_identity: "agent-001", repository: "owner/repo", issue: { id: "123", number: 42, title: "Bug: login fails" }, action: "triage_output" },
  github_push_webhook: { ref: "refs/heads/main", repository: { full_name: "owner/repo" }, head_commit: { sha: "abc123", message: "fix: resolve login issue" } },
};

const SOURCE_LABELS: Record<string, string> = {
  github_commit_payload: "GitHub Commit",
  github_push_webhook: "GitHub Push",
  github_issue_event: "GitHub Issue",
  compliance_report: "Compliance Report",
  otel_genai_trace: "AI Trace",
  task_deliverable: "Task Deliverable",
};

function canonicalJson(obj: unknown): string {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return JSON.stringify(obj);
  const sorted = Object.keys(obj as Record<string, unknown>).sort();
  const ordered: Record<string, unknown> = {};
  for (const key of sorted) ordered[key] = (obj as Record<string, unknown>)[key];
  return JSON.stringify(ordered);
}

function sha256Hex(input: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)).then((b) =>
    Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("")
  );
}

export default function PostEvidencePage() {
  const [commitment, setCommitment] = useState("");
  const [sourceType, setSourceType] = useState("github_commit_payload");
  const [payloadText, setPayloadText] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [canonical, setCanonical] = useState("");
  const [digest, setDigest] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string; hash?: string } | null>(null);
  const [signing, setSigning] = useState(false);
  const [phase, setPhase] = useState<"idle" | "signing" | "posting">("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("commitment")) setCommitment(params.get("commitment")!);
    const storedKey = sessionStorage.getItem("passport_agent_key");
    if (storedKey) setPrivateKey(storedKey);
  }, []);

  // Debounced canonical JSON computation
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!payloadText.trim()) { setCanonical(""); setDigest(""); setJsonError(""); return; }
      try {
        const parsed = JSON.parse(payloadText);
        const canon = canonicalJson(parsed);
        setCanonical(canon);
        // Simple SHA-256 in the browser (crypto.subtle)
        crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon)).then((buf) => {
          setDigest(Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""));
        });
        setJsonError("");
      } catch {
        setCanonical("");
        setDigest("");
        setJsonError("Invalid JSON — check your syntax");
      }
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [payloadText]);

  const loadSample = useCallback(() => {
    const sample = SAMPLE_PAYLOADS[sourceType];
    if (sample) setPayloadText(JSON.stringify(sample, null, 2));
  }, [sourceType]);

  const handleSignAndPost = useCallback(async () => {
    if (!commitment.trim() || !privateKey.trim() || !digest) return;
    setPhase("signing");
    setResult(null);
    try {
      // Import noble/ed25519 dynamically (browser-compatible)
      const { sign } = await import("@noble/ed25519");
      const { bytesToHex, hexToBytes } = await import("@noble/hashes/utils.js");
      await import("@/lib/receipt/crypto");

      if (!/^[0-9a-f]{64}$/i.test(privateKey.trim())) {
        setResult({ ok: false, message: "Private key must be 64 hex characters" });
        setPhase("idle");
        return;
      }

      setPhase("posting");
      const signature = bytesToHex(await sign(new TextEncoder().encode(digest), hexToBytes(privateKey.trim())));

      const res = await fetch(`/api/v1/passport/agents/${commitment.trim()}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_type: sourceType, payload: JSON.parse(payloadText), signature }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 201) {
        setResult({ ok: true, message: "Evidence posted successfully!", hash: data.event_commitment_hash });
        sessionStorage.setItem("passport_agent_key", privateKey.trim());
      } else if (res.status === 401) {
        setResult({ ok: false, message: "Invalid signature — check your private key" });
      } else if (res.status === 429) {
        setResult({ ok: false, message: "Rate limit exceeded — wait and retry" });
      } else if (res.status >= 500) {
        setResult({ ok: false, message: "Server error — try again later" });
      } else {
        setResult({ ok: false, message: data.error || `HTTP ${res.status}` });
      }
    } catch (e) {
      setResult({ ok: false, message: "Network error — check your connection" });
    } finally {
      setPhase("idle");
    }
  }, [commitment, privateKey, digest, sourceType, payloadText]);

  const isValidJson = payloadText.trim() && !jsonError;
  const canSign = commitment.trim() && isValidJson && privateKey.trim() && digest;
  const busy = phase !== "idle";

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Post evidence</h1>
            <a href="/docs/integrations" className="text-xs text-indigo-600 hover:underline sm:text-sm">Schema help →</a>
          </div>
          <p className="mt-2 text-sm text-slate-600">Sign and post evidence for an enrolled agent — no code required.</p>

          <div className="mt-6 space-y-4">
            {/* Commitment */}
            <div>
              <label className="block text-sm font-medium text-slate-700">Subject commitment</label>
              <input
                type="text"
                value={commitment}
                onChange={(e) => setCommitment(e.target.value)}
                placeholder="64-char hex from enrollment"
                className="mt-1 w-full rounded border px-3 py-2 font-mono text-sm"
              />
            </div>

            {/* Source type */}
            <div>
              <label className="block text-sm font-medium text-slate-700">Source type</label>
              <div className="mt-1 flex gap-2">
                <select
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value)}
                  className="flex-1 rounded border px-3 py-2 text-sm"
                >
                  {Object.entries(SOURCE_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
                <button onClick={loadSample} className="shrink-0 rounded border px-3 py-2 text-sm hover:bg-slate-50">
                  Load sample
                </button>
              </div>
            </div>

            {/* Payload JSON */}
            <div>
              <label className="block text-sm font-medium text-slate-700">Payload JSON</label>
              <textarea
                value={payloadText}
                onChange={(e) => setPayloadText(e.target.value)}
                placeholder='{ "sha": "...", "commit": { "message": "..." } }'
                className={`mt-1 w-full min-h-[200px] rounded border px-3 py-2 font-mono text-sm ${jsonError ? "border-red-400" : ""}`}
                rows={12}
              />
              {jsonError && <p className="mt-1 text-xs text-red-600">{jsonError}</p>}
            </div>

            {/* Canonical JSON preview */}
            {canonical && (
              <div className="rounded-lg border bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-500">Canonical JSON (sorted keys, compact)</p>
                <pre className="mt-1 overflow-x-auto font-mono text-xs text-slate-700">{canonical}</pre>
              </div>
            )}

            {/* Digest */}
            {digest && (
              <div className="rounded-lg border bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-500">SHA-256 digest to sign</p>
                <pre className="mt-1 font-mono text-xs break-all text-slate-700">{digest}</pre>
              </div>
            )}

            {/* Private key */}
            <div>
              <label className="block text-sm font-medium text-slate-700">Private key (hex)</label>
              <input
                type="password"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="64-char hex from enrollment"
                className="mt-1 w-full rounded border px-3 py-2 font-mono text-sm"
              />
            </div>

            {/* Sign & Post */}
            <button
              onClick={handleSignAndPost}
              disabled={!canSign || busy}
              className="w-full rounded-lg bg-indigo-600 px-6 py-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 sm:w-auto"
            >
              {phase === "signing" ? "Signing…" : phase === "posting" ? "Posting…" : "Sign & Post"}
            </button>

            {/* Result */}
            {result && (
              <div className={`rounded-lg border p-4 text-sm ${result.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"}`}>
                <p className="font-medium">{result.message}</p>
                {result.hash && (
                  <div className="mt-2 space-y-1">
                    <p className="font-mono text-xs break-all">{result.hash}</p>
                    <a href={`/profiles/${commitment}`} className="text-indigo-600 hover:underline text-xs">View profile →</a>
                  </div>
                )}
                {!result.ok && (
                  <button onClick={() => setResult(null)} className="mt-2 text-xs underline">Dismiss</button>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}