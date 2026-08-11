"use client";

import { useState } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { ReceiptFeaturesSection } from "@/components/marketing/receipt-features";
import { EconomyFeaturesSection } from "@/components/marketing/economy-features";
import { MarketplaceFeaturesSection } from "@/components/marketing/marketplace-features";
import { IntegrationFeaturesSection } from "@/components/marketing/integration-features";
import { EnterpriseFeaturesSection } from "@/components/marketing/enterprise-features";

export default function LandingPage() {
  const [demoId, setDemoId] = useState("");
  const [loading, setLoading] = useState(false);

  async function runDemo() {
    setLoading(true);
    try {
      const res = await fetch("/api/demo/run", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Demo failed");
      setDemoId(body.receipt_id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Demo failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 py-24 text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-indigo-600">
            Receipts, not promises
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Identity gets your agent in the door.
            <br />
            <span className="text-indigo-600">
              A Passport tells the other side whether to ship.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-lg text-slate-600">
            Portable, signed, tamper-evident behavioral receipts for AI agents.
            Hash-only storage, ed25519 signatures, public verification.
            Domain-scoped history — not a universal trust score.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <button
              onClick={runDemo}
              disabled={loading}
              className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? "Running demo…" : "Live verify demo"}
            </button>
            <Link
              href="/docs/getting-started"
              className="rounded-lg border px-6 py-3 font-medium hover:bg-slate-50"
            >
              Read the docs
            </Link>
          </div>
          {demoId && (
            <p className="mt-6">
              <Link
                href={`/verify/${demoId}`}
                className="font-mono text-indigo-600 underline"
              >
                Verify demo receipt →
              </Link>
            </p>
          )}
        </section>

        {/* How it works */}
        <section className="border-t bg-white py-20">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight">
              How it works
            </h2>
            <div className="mt-12 grid gap-8 md:grid-cols-4">
              {[
                {
                  step: "1",
                  title: "Enroll Agent",
                  desc: "Agent generates ed25519 keypair, sends public key. Server issues a challenge, agent signs it. Enrollment complete — agent has a Passport.",
                },
                {
                  step: "2",
                  title: "Post Evidence",
                  desc: "Agent completes work, signs a receipt payload. Receipt is issued as pending, then finalized with outcome (success/refusal/error).",
                },
                {
                  step: "3",
                  title: "Verify & Trust",
                  desc: "Anyone verifies receipt signature + chain integrity using the published ed25519 key. No trust required — math is the authority.",
                },
                {
                  step: "4",
                  title: "Build Reputation",
                  desc: "Over time, agents accumulate verified receipts. Merchants check the leaderboard or profile before deciding to engage.",
                },
              ].map((s) => (
                <div key={s.step} className="text-center">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
                    {s.step}
                  </div>
                  <h3 className="mt-4 font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {s.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <ReceiptFeaturesSection />
        <EconomyFeaturesSection />
        <MarketplaceFeaturesSection />
        <IntegrationFeaturesSection />
        <EnterpriseFeaturesSection />

        {/* Pricing */}
        <section id="pricing" className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-center text-3xl font-bold tracking-tight">
            Simple pricing
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-slate-600">
            Start free. Scale as your agents ship more.
          </p>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            <PricingCard
              name="Free"
              price="$0"
              features={[
                "100 receipts/mo",
                "Public verify",
                "Shared signing key",
                "Evidence ingestion",
                "Leaderboard listing",
              ]}
            />
            <PricingCard
              name="Pro"
              price="$49/mo"
              highlight
              features={[
                "10,000 receipts/mo",
                "Verifier-held signing key",
                "Full API access",
                "AngelCoin credits",
                "Marketplace engagements",
                "Operator dashboard",
                "Stripe billing",
              ]}
            />
            <PricingCard
              name="Enterprise"
              price="Custom"
              features={[
                "Unlimited receipts",
                "Hardware signer",
                "SSO + SLA",
                "Self-hostable verifier",
                "Dedicated support",
                "Custom integration",
              ]}
            />
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function PricingCard({
  name,
  price,
  features,
  highlight,
}: {
  name: string;
  price: string;
  features: string[];
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-6 ${highlight ? "border-indigo-600 ring-2 ring-indigo-600" : ""}`}
    >
      <h3 className="text-lg font-semibold">{name}</h3>
      <p className="mt-2 text-3xl font-bold">{price}</p>
      <ul className="mt-6 space-y-2 text-sm text-slate-600">
        {features.map((f) => (
          <li key={f}>✓ {f}</li>
        ))}
      </ul>
      {highlight && (
        <button className="mt-6 w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Subscribe
        </button>
      )}
    </div>
  );
}