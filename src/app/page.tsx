"use client";

import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { LiveVerifyDemo } from "@/components/marketing/live-verify-demo";
import { SubscribeButton } from "@/components/marketing/subscribe-button";
import { ReceiptFeaturesSection } from "@/components/marketing/receipt-features";
import { EconomyFeaturesSection } from "@/components/marketing/economy-features";
import { MarketplaceFeaturesSection } from "@/components/marketing/marketplace-features";
import { IntegrationFeaturesSection } from "@/components/marketing/integration-features";
import { EnterpriseFeaturesSection } from "@/components/marketing/enterprise-features";
import { ReputationTiersSection } from "@/components/marketing/reputation-tiers";

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-600 sm:text-sm">
            Receipts, not promises
          </p>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Identity gets your agent in the door.
            <br />
            <span className="text-indigo-600">
              A Passport tells the other side whether to ship.
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-3xl text-base text-slate-600 sm:mt-6 sm:text-lg">
            Portable, signed, tamper-evident behavioral receipts for AI agents.
            Hash-only storage, ed25519 signatures, public verification.
            Domain-scoped history — not a universal trust score.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3 sm:gap-4">
            <LiveVerifyDemo />
            <Link
              href="/docs/getting-started"
              className="rounded-lg border px-6 py-3 text-sm font-medium hover:bg-slate-50 text-center"
            >
              Read the docs
            </Link>
          </div>
        </section>

        <section className="border-y bg-slate-50 py-12 sm:py-16">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 sm:gap-6 sm:px-6 md:grid-cols-3">
            <Link href="/verify/demo" className="rounded-xl border bg-white p-6 transition hover:border-indigo-400">
              <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Verify a receipt</p>
              <h2 className="mt-2 text-xl font-semibold">Inspect the artifact before you trust it.</h2>
              <p className="mt-2 text-sm text-slate-600">See signature, expiry, revocation, chain, and outcome state in one public view.</p>
            </Link>
            <Link href="/docs/getting-started" className="rounded-xl border bg-white p-6 transition hover:border-indigo-400">
              <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Integrate Passport</p>
              <h2 className="mt-2 text-xl font-semibold">Issue your first receipt in 5 minutes.</h2>
              <p className="mt-2 text-sm text-slate-600">Enroll an agent, post evidence, and verify the signed result with copy-paste API calls.</p>
            </Link>
            <Link href="/leaderboard" className="rounded-xl border bg-white p-6 transition hover:border-indigo-400">
              <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Evaluate agents</p>
              <h2 className="mt-2 text-xl font-semibold">Check evidence, not a universal score.</h2>
              <p className="mt-2 text-sm text-slate-600">Review domain-scoped history, outcomes, and failure behavior before you ship.</p>
            </Link>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
          <div className="grid gap-8 sm:gap-10 md:grid-cols-[1fr_1.2fr] md:items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 sm:text-sm">Inspect the outcome</p>
              <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">A receipt is more than success.</h2>
              <p className="mt-3 text-sm text-slate-600 sm:mt-4 sm:text-base">Passport preserves the operational result so counterparties can evaluate recovery and refusal behavior, not just a polished success count.</p>
            </div>
            <div className="grid gap-2 sm:gap-3 sm:grid-cols-2">
              {[
                ["success", "Completed and signed"],
                ["refusal", "Declined within authority"],
                ["timeout", "Did not complete in time"],
                ["failure", "Recorded logic or execution error"],
              ].map(([status, description]) => (
                <div key={status} className="rounded-lg border p-4">
                  <p className="font-mono text-sm font-semibold text-slate-900">{status}</p>
                  <p className="mt-1 text-sm text-slate-600">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="border-t bg-white py-12 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
              How it works
            </h2>
            <div className="mt-8 grid gap-6 sm:mt-12 sm:grid-cols-2 md:grid-cols-4">
              {[
                {
                  step: "1",
                  title: "Enroll Agent",
                  desc: "Agent generates ed25519 keypair, sends public key. Server issues a challenge, agent signs it. Enrollment complete — agent has a Passport.",
                },
                {
                  step: "2",
                  title: "Sign & Finalize",
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
        <ReputationTiersSection />
        <EconomyFeaturesSection />
        <MarketplaceFeaturesSection />
        <IntegrationFeaturesSection />
        <EnterpriseFeaturesSection />

        {/* Pricing */}
<section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
            Simple pricing
          </h2>
           <p className="mx-auto mt-3 max-w-xl text-center text-sm text-slate-600 sm:text-base">
             100 receipts/mo for experiments. 10,000 receipts/mo for a production agent fleet.
           </p>
          <div className="mt-10 grid gap-6 sm:mt-12 md:grid-cols-3">
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
              description="Solo builders testing a trustworthy workflow."
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
              description="Production agent fleets with operator controls."
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
              description="A dedicated trust boundary with custom controls."
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
  description,
}: {
  name: string;
  price: string;
  features: string[];
  highlight?: boolean;
  description: string;
}) {
  return (
    <div
      className={`rounded-xl border p-6 ${highlight ? "border-indigo-600 ring-2 ring-indigo-600" : ""}`}
    >
      <h3 className="text-lg font-semibold">{name}</h3>
      <p className="mt-2 text-3xl font-bold">{price}</p>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
      <ul className="mt-6 space-y-2 text-sm text-slate-600">
        {features.map((f) => (
          <li key={f}>✓ {f}</li>
        ))}
      </ul>
      {highlight && (
        <SubscribeButton />
      )}
    </div>
  );
}
