"use client";

import { useState } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

type Endpoint = {
  method: "GET" | "POST";
  path: string;
  description: string;
  example: string;
};

const ENDPOINTS: Endpoint[] = [
  { method: "GET", path: "/api/v1/profiles/{hash}", description: "Get agent profile with evidence timeline", example: "a".repeat(64) },
  { method: "GET", path: "/api/v1/verify/{hash}", description: "Get agent trust report (reputation, receipts, verification)", example: "a".repeat(64) },
  { method: "GET", path: "/api/v1/leaderboard", description: "Top agents ranked by reputation score", example: "" },
  { method: "GET", path: "/api/v1/agents", description: "Discover agents by domain, score, limit", example: "?domain=CODE_GENERATION&min_score=400" },
  { method: "GET", path: "/api/v1/transparency/keys", description: "Public key transparency log", example: "" },
  { method: "GET", path: "/api/v1/receipts/checkpoints/latest", description: "Latest Merkle checkpoint", example: "" },
  { method: "GET", path: "/api/v1/compliance/frameworks", description: "Supported compliance frameworks", example: "" },
  { method: "GET", path: "/api/v1/digest/{hash}", description: "Weekly reputation digest SVG card", example: "a".repeat(64) },
  { method: "GET", path: "/api/v1/badge/{hash}", description: "SVG shield badge with tier color", example: "a".repeat(64) },
  { method: "GET", path: "/.well-known/bill-of-rights.json", description: "AI Bill of Rights (signed)", example: "" },
];

export default function PlaygroundPage() {
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint>(ENDPOINTS[0]);
  const [inputValue, setInputValue] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [curlCmd, setCurlCmd] = useState("");

  async function runRequest() {
    setError("");
    setLoading(true);
    setResult(null);

    const path = selectedEndpoint.path.replace("{hash}", inputValue || "a".repeat(64));
    const url = `/api/v1/playground-proxy${path}`;
    const curlUrl = `https://passport.metis.gold${path}`;

    setCurlCmd(`curl -s ${curlUrl} | jq`);

    try {
      const res = await fetch(path);
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      setError(e.message || "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <main className="flex-1 mx-auto max-w-5xl w-full px-6 py-12">
        <Link href="/" className="text-sm text-indigo-600 hover:underline">
          ← Passport
        </Link>

        <h1 className="mt-6 text-3xl font-bold tracking-tight">API Playground</h1>
        <p className="mt-2 text-slate-600">
          Try Passport endpoints live — no API key required. Enter a commitment hash or leave blank for defaults.
        </p>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_2fr]">
          {/* Endpoint selector */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-900">Endpoints</h2>
            <div className="max-h-[500px] overflow-y-auto space-y-1">
              {ENDPOINTS.map((ep) => (
                <button
                  key={ep.path}
                  onClick={() => {
                    setSelectedEndpoint(ep);
                    setResult(null);
                    setError("");
                    setInputValue(ep.example || "");
                  }}
                  className={`w-full text-left rounded-lg px-3 py-2 text-xs transition ${
                    selectedEndpoint.path === ep.path
                      ? "bg-indigo-100 text-indigo-800"
                      : "hover:bg-slate-50 text-slate-600"
                  }`}
                >
                  <span className={`font-mono font-bold ${ep.method === "GET" ? "text-emerald-600" : "text-amber-600"}`}>
                    {ep.method}
                  </span>
                  <span className="ml-2 font-mono">{ep.path.replace(/\{.*?\}/g, ":arg")}</span>
                  <p className="mt-0.5 text-[10px] text-slate-400">{ep.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Request panel */}
          <div className="space-y-4">
            <div className="rounded-xl border bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Request</h2>
              <div className="mt-3 flex items-center gap-2">
                <span className={`rounded px-2 py-1 font-mono text-xs font-bold text-white ${
                  selectedEndpoint.method === "GET" ? "bg-emerald-600" : "bg-amber-600"
                }`}>
                  {selectedEndpoint.method}
                </span>
                <code className="flex-1 rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 border border-slate-200">
                  {selectedEndpoint.path.replace(/\{hash\}/g, inputValue || "{hash}")}
                </code>
              </div>

              {selectedEndpoint.path.includes("{hash}") && (
                <div className="mt-3">
                  <label className="text-xs font-medium text-slate-600">Commitment Hash</label>
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="64-character hex hash"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}

              <button
                onClick={runRequest}
                disabled={loading}
                className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition disabled:opacity-50"
              >
                {loading ? "Running..." : "Run Request"}
              </button>
            </div>

            {/* Curl command */}
            {curlCmd && (
              <div className="rounded-xl border bg-slate-900 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400">cURL</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(curlCmd)}
                    className="text-xs text-indigo-400 hover:underline"
                  >
                    Copy
                  </button>
                </div>
                <pre className="mt-2 font-mono text-xs text-emerald-300 select-all overflow-x-auto">{curlCmd}</pre>
              </div>
            )}

            {/* Response */}
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-xs font-medium text-red-700">Error</p>
                <p className="mt-1 text-xs text-red-600">{error}</p>
              </div>
            )}

            {result && (
              <div className="rounded-xl border bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900">Response</h2>
                  <button
                    onClick={() => navigator.clipboard.writeText(JSON.stringify(result, null, 2))}
                    className="text-xs text-indigo-400 hover:underline"
                  >
                    Copy JSON
                  </button>
                </div>
                <pre className="mt-3 max-h-96 overflow-y-auto rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700 border border-slate-200 select-all">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>

        <div className="mt-10 text-center">
          <p className="text-xs text-slate-400">
            All endpoints are public and rate-limited.{" "}
            <Link href="/docs/api-reference" className="text-indigo-600 underline">Full API Reference →</Link>
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}