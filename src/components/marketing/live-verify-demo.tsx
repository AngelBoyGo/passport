"use client";

import { useState } from "react";
import Link from "next/link";

export function LiveVerifyDemo() {
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function startDemo() {
    setState("loading");
    setMessage("");
    try {
      const response = await fetch("/api/v1/public-key");
      const body = (await response.json()) as { algorithm?: string; public_key?: string };
      if (!response.ok || body.algorithm !== "ed25519" || !/^[0-9a-f]{64}$/i.test(body.public_key ?? "")) {
        throw new Error("The public verifier is unavailable.");
      }
      setState("success");
      setMessage("Public key loaded. This sample receipt is ready to inspect.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "The verifier is unavailable.");
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={startDemo}
        disabled={state === "loading"}
        className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {state === "loading" ? "Checking verifier..." : "Live verify demo"}
      </button>
      {state !== "idle" && (
        <div
          data-testid="demo-verification-result"
          className={`mt-5 rounded-lg border p-4 text-left text-sm ${
            state === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : state === "error"
                ? "border-red-200 bg-red-50 text-red-900"
                : "border-slate-200 bg-slate-50 text-slate-700"
          }`}
          aria-live="polite"
        >
          <p className="font-semibold">
            {state === "success" ? "Verifier online" : state === "error" ? "Verification unavailable" : "Loading verifier"}
          </p>
          <p className="mt-1">{message}</p>
          {state === "success" && (
            <Link href="/verify/demo" className="mt-3 inline-block font-medium underline">
              Inspect the sample receipt →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
