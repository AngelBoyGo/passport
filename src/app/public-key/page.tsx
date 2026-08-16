"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

export default function PublicKeyPage() {
  const [keyData, setKeyData] = useState<{
    algorithm: string;
    public_key: string;
    note: string;
  } | null>(null);
  const [hash, setHash] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/v1/public-key")
      .then((r) => r.json())
      .then(setKeyData)
      .catch(() => setError("Could not load public key"));
  }, []);

  const validHash = /^[0-9a-f]{64}$/i.test(hash);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-4xl px-6 py-16">
          <Link href="/" className="text-sm text-indigo-600 hover:underline">
            ← Passport
          </Link>
          <h1 className="mt-6 text-3xl font-bold tracking-tight">
            Public verifying key
          </h1>
          <p className="mt-3 text-slate-600">
            Passport&apos;s Ed25519 signing key. Use this to verify any receipt
            signature offline — no server call required.
          </p>

          {error && (
            <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          {keyData && (
            <div className="mt-8 space-y-6">
              <div className="rounded-xl border bg-slate-50 p-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Algorithm
                </p>
                <p className="mt-1 font-mono text-sm">{keyData.algorithm}</p>

                <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Public key (hex)
                </p>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-white p-3 font-mono text-xs break-all">
                  {keyData.public_key}
                </pre>
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(keyData.public_key)
                  }
                  className="mt-2 text-xs text-indigo-600 hover:underline"
                >
                  Copy to clipboard
                </button>

                <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Caching
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  <code className="rounded bg-slate-200 px-1 text-xs">
                    Cache-Control: public, max-age=3600
                  </code>{" "}
                  — verifiers should refresh after 1 hour. Do not treat the key
                  as immutable.
                </p>

                <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Note
                </p>
                <p className="mt-1 text-sm text-slate-600">{keyData.note}</p>
              </div>

              <div className="rounded-xl border bg-indigo-50 p-6">
                <h2 className="text-lg font-semibold">
                  🔍 Verify a receipt
                </h2>
                <p className="mt-2 text-sm text-slate-700">
                  Paste a receipt ID to verify its signature, expiry, and
                  revocation status.
                </p>
                <div className="mt-4 flex gap-2">
                  <input
                    type="text"
                    value={hash}
                    onChange={(e) => setHash(e.target.value.trim())}
                    placeholder="rcpt_..."
                    className="flex-1 rounded-lg border px-3 py-2 font-mono text-sm"
                  />
                  <Link
                    href={validHash ? `/verify/${hash}` : "#"}
                    className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${
                      validHash
                        ? "bg-indigo-600 hover:bg-indigo-700"
                        : "bg-slate-300 pointer-events-none"
                    }`}
                  >
                    Verify
                  </Link>
                </div>
              </div>

              <div className="rounded-xl border bg-slate-50 p-6">
                <h2 className="text-lg font-semibold">
                  🏅 Agent badge
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Generate a cacheable SVG badge for any enrolled agent.
                </p>
                <div className="mt-4 flex gap-2">
                  <input
                    type="text"
                    value={hash}
                    onChange={(e) => setHash(e.target.value.trim())}
                    placeholder={"a".repeat(64)}
                    className="flex-1 rounded-lg border px-3 py-2 font-mono text-sm"
                  />
                  {validHash && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="h-10 w-auto"
                      src={`/api/v1/badge/${hash}`}
                      alt="Badge preview"
                    />
                  )}
                </div>
                {validHash && (
                  <p className="mt-2 text-xs text-slate-500">
                    Embed:{" "}
                    <code className="rounded bg-slate-200 px-1">
                      {`https://passport.metis.gold/api/v1/badge/${hash}`}
                    </code>
                  </p>
                )}
              </div>

              <div className="rounded-xl border bg-slate-50 p-6">
                <h2 className="text-lg font-semibold">
                  Offline verification
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Any third party can verify a receipt without trusting the
                  Passport server:
                </p>
                <ol className="mt-4 ml-4 list-decimal space-y-2 text-sm text-slate-700">
                  <li>
                    Fetch the receipt from{" "}
                    <code className="rounded bg-slate-200 px-1 text-xs">
                      GET /api/v1/receipts/:id/public-manifest
                    </code>
                  </li>
                  <li>
                    Recompute <code className="rounded bg-slate-200 px-1 text-xs">content_hash</code> from the
                    canonical field set (sorted keys, compact JSON, SHA-256)
                  </li>
                  <li>
                    Verify the Ed25519 signature against the public key above
                  </li>
                  <li>
                    Check expiry is in the future and revocation status is{" "}
                    <code className="rounded bg-slate-200 px-1 text-xs">active</code>
                  </li>
                </ol>
                <p className="mt-4 text-sm text-slate-600">
                  See{" "}
                  <Link
                    href="/docs/api-reference"
                    className="text-indigo-600 hover:underline"
                  >
                    API Reference → Receipt canonicalization
                  </Link>{" "}
                  for the exact field set and sort order.
                </p>
              </div>
            </div>
          )}

          {!keyData && !error && (
            <div className="mt-8 text-sm text-slate-500">
              Loading public key…
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}