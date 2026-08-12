"use client";

import Link from "next/link";
import { useState } from "react";

export function SubscribeButton() {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function subscribe() {
    setLoading(true);
    setMessage("");
    try {
      const sessionResponse = await fetch("/api/auth/session");
      if (!sessionResponse.ok) {
        setMessage("Sign in is required before starting a Pro subscription.");
        return;
      }

      const checkoutResponse = await fetch("/api/stripe/checkout", { method: "POST" });
      const checkout = (await checkoutResponse.json()) as { url?: string; error?: string };
      if (!checkoutResponse.ok || !checkout.url) {
        throw new Error(checkout.error ?? "Unable to start checkout.");
      }
      window.location.assign(checkout.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to start checkout.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={subscribe}
        disabled={loading}
        className="mt-6 w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {loading ? "Checking account..." : "Subscribe"}
      </button>
      {message && (
        <p className="mt-3 text-center text-sm text-slate-600" aria-live="polite">
          {message} {message.startsWith("Sign in") && (
            <Link href="/login?next=%2F%23pricing" className="font-medium text-indigo-600 underline">
              Sign in to subscribe
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
