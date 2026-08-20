"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Failed to submit request");
        return;
      }

      setSubmitted(true);
      if (data.resetUrl) {
        setDevResetUrl(data.resetUrl);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Link href="/login" className="text-sm text-indigo-600 hover:underline">
          ← Back to sign in
        </Link>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Forgot password</h1>
        <p className="mt-1 text-sm text-slate-600">
          Enter your email and we&apos;ll send you a password reset link.
        </p>

        {submitted ? (
          <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 space-y-3">
            <p className="font-medium">Reset link dispatched</p>
            <p className="text-xs text-green-700 leading-relaxed">
              If that email is registered, you will receive a reset link valid for 15 minutes.
            </p>
            {devResetUrl && (
              <div className="mt-3 pt-3 border-t border-green-200">
                <p className="text-xs font-semibold uppercase tracking-wide text-green-900">Dev Reset Link:</p>
                <a href={devResetUrl} className="text-xs text-indigo-700 underline break-all block mt-1">
                  {devResetUrl}
                </a>
              </div>
            )}
            <Link
              href="/login"
              className="mt-4 block w-full rounded-lg bg-indigo-600 py-2 text-center text-sm font-medium text-white hover:bg-indigo-700"
            >
              Return to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                placeholder="you@example.com"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? "Sending link…" : "Send reset link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
