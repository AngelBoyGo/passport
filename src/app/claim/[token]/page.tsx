"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { use } from "react";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

export default function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [status, setStatus] = useState<"loading" | "found" | "claimed" | "expired" | "error">("loading");
  const [walletData, setWalletData] = useState<{
    commitment: string;
    angl: number;
    platform: string;
    email: string;
  } | null>(null);

  useEffect(() => {
    async function checkToken() {
      try {
        const res = await fetch(`/api/v1/claim/${token}`);
        if (res.ok) {
          const data = await res.json();
          if (data.claimed) {
            setStatus("claimed");
          } else if (data.expired) {
            setStatus("expired");
          } else {
            setWalletData(data);
            setStatus("found");
          }
        } else {
          setStatus("error");
        }
      } catch {
        setStatus("error");
      }
    }
    checkToken();
  }, [token]);

  async function claim() {
    try {
      const res = await fetch(`/api/v1/claim/${token}`, { method: "POST" });
      if (res.ok) {
        setStatus("claimed");
      }
    } catch {}
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <main className="flex-1 mx-auto max-w-lg w-full px-6 py-16">
        <Link href="/" className="text-sm text-indigo-600 hover:underline">
          ← Passport
        </Link>

        <div className="mt-8 rounded-xl border bg-white shadow-sm p-8 text-center">
          {status === "loading" && (
            <div className="animate-pulse space-y-4">
              <div className="h-8 bg-slate-200 rounded w-2/3 mx-auto" />
              <div className="h-4 bg-slate-200 rounded w-1/2 mx-auto" />
            </div>
          )}

          {status === "found" && walletData && (
            <div className="space-y-6">
              <p className="text-4xl">🎁</p>
              <h1 className="text-2xl font-bold">You have ANGEL waiting</h1>
              <p className="text-sm text-slate-600">
                {walletData.platform} purchased {walletData.angl.toLocaleString()} ANGEL
                on your behalf. Claim your wallet to view your balance and use it
                across all Passport-enabled platforms.
              </p>
              <div className="rounded-lg bg-purple-50 p-4">
                <p className="text-3xl font-bold text-purple-700">{walletData.angl.toLocaleString()} ANGEL</p>
                <p className="text-xs text-slate-500 mt-1">≈ ${(walletData.angl * 5).toFixed(2)} purchasing power</p>
              </div>
              <p className="text-xs text-slate-400">
                Sent to: {walletData.email}
              </p>
              <button
                onClick={claim}
                className="w-full rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition"
              >
                Claim My Wallet →
              </button>
              <p className="text-[10px] text-slate-400">
                Claiming links this wallet to your Passport login. You&apos;ll be able to
                view your balance, purchase history, and spend ANGEL on any platform
                that accepts Passport.
              </p>
            </div>
          )}

          {status === "claimed" && (
            <div className="space-y-4">
              <p className="text-4xl">✅</p>
              <h1 className="text-2xl font-bold">Wallet Claimed!</h1>
              <p className="text-sm text-slate-600">
                Your ANGEL balance is now visible on your Passport dashboard.
                You can view it anytime at passport.metis.gold.
              </p>
              <Link
                href="/dashboard"
                className="inline-block rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition"
              >
                Go to Dashboard →
              </Link>
            </div>
          )}

          {status === "expired" && (
            <div className="space-y-4">
              <p className="text-4xl">⏰</p>
              <h1 className="text-2xl font-bold">Link Expired</h1>
              <p className="text-sm text-slate-600">
                This claim link has expired. Your ANGEL is safe — contact the
                platform that purchased it for a new link.
              </p>
            </div>
          )}

          {status === "error" && (
            <div className="space-y-4">
              <p className="text-4xl">❌</p>
              <h1 className="text-2xl font-bold">Invalid Link</h1>
              <p className="text-sm text-slate-600">
                This claim link is invalid or has already been used.
              </p>
              <Link
                href="/"
                className="inline-block rounded-lg border border-slate-300 px-6 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                Back to Passport
              </Link>
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}