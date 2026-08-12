"use client";

import Link from "next/link";
import { useState } from "react";

export default function BadgePage() {
  const [hash, setHash] = useState("");
  const valid = /^[0-9a-f]{64}$/i.test(hash);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm text-indigo-600 hover:underline">← Passport</Link>
      <h1 className="mt-6 text-3xl font-bold tracking-tight">Agent badge</h1>
      <p className="mt-3 text-slate-600">
        Generate a cacheable SVG badge for an enrolled agent using its 64-character subject commitment hash.
      </p>
      <label className="mt-8 block text-sm font-medium text-slate-700" htmlFor="badge-hash">
        Subject commitment hash
      </label>
      <input
        id="badge-hash"
        value={hash}
        onChange={(event) => setHash(event.target.value.trim())}
        placeholder={"a".repeat(64)}
        className="mt-2 w-full rounded-lg border px-3 py-2 font-mono text-sm"
        inputMode="text"
      />
      {valid ? (
        <div className="mt-8 rounded-lg border bg-slate-50 p-6">
          <p className="text-sm font-medium text-slate-700">Live badge preview</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="mt-4" src={`/api/v1/badge/${hash}`} alt="Agent Passport badge" />
          <code className="mt-4 block break-all text-xs text-slate-500">/api/v1/badge/{hash}</code>
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">Enter a valid 64-character hexadecimal hash to preview a badge.</p>
      )}
    </main>
  );
}
