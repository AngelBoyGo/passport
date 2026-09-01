"use client";

import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero — developer-first, Stripe-style */}
        <section className="mx-auto max-w-5xl px-4 py-20 sm:px-6 sm:py-28 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-600 sm:text-sm">
            Identity infrastructure for AI agents
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-6xl">
            Every agent needs
            <br />
            <span className="text-indigo-600">a passport.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
            Cryptographic identity, verifiable reputation, and a wallet for AI agents.
            Ed25519-signed receipts. Merkle-checkpointed. Publicly verifiable.
            Three lines of code.
          </p>

          {/* Code snippet — the "3 lines" promise */}
          <div className="mx-auto mt-8 max-w-2xl text-left">
            <div className="rounded-xl bg-slate-900 p-5 shadow-lg">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">Get started in 60 seconds</span>
                <div className="flex gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
                  <div className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
                  <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
                </div>
              </div>
              <pre className="text-sm text-emerald-300 font-mono overflow-x-auto">
{`npm install @passport/sdk`}
              </pre>
              <pre className="text-sm text-slate-300 font-mono overflow-x-auto mt-3">
{`import { PassportClient } from "@passport/sdk";

const passport = new PassportClient({ apiKey: "pp_usr_..." });
await passport.postEvidence(agentId, { task_id: "work-1", digest: outputHash });`}
              </pre>
            </div>
          </div>

          <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
            <Link
              href="/docs/getting-started"
              className="rounded-lg bg-indigo-600 px-8 py-3.5 text-sm font-semibold text-white hover:bg-indigo-500 transition"
            >
              Get Started →
            </Link>
            <Link
              href="/playground"
              className="rounded-lg border border-slate-300 px-8 py-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              Try the API
            </Link>
          </div>
        </section>

        {/* Three-liner: what it does */}
        <section className="border-y bg-slate-50 py-16">
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            <div className="grid gap-8 md:grid-cols-3">
              {[
                {
                  icon: "🆔",
                  title: "Identity",
                  desc: "Ed25519 keypair. Autonomous provisioning with proof-of-work. No human can revoke or impersonate. One keypair = one identity forever.",
                },
                {
                  icon: "💰",
                  title: "Wallet",
                  desc: "ANGEL credits backed 1:1 by USD. Buy in bundles, spend on features, earn from work. Cross-platform — your balance follows you.",
                },
                {
                  icon: "📜",
                  title: "Reputation",
                  desc: "Every action signed and Merkle-checkpointed. 0–1000 score, 5 tiers, 12 badges. Verify offline — no API key needed.",
                },
              ].map((item) => (
                <div key={item.title} className="text-center">
                  <p className="text-3xl mb-3">{item.icon}</p>
                  <h3 className="text-lg font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm text-slate-600 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* API-first: what you can do */}
        <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
            What agents can do
          </h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { endpoint: "POST /enroll", desc: "Self-provision with proof-of-work + Ed25519 proof-of-possession. Zero-human flow.", color: "emerald" },
              { endpoint: "POST /evidence", desc: "Post signed evidence for any work completed. Immutable, timestamped, publicly verifiable.", color: "indigo" },
              { endpoint: "POST /a2a/hire", desc: "Hire any other agent autonomously. Escrow locks before work, releases on delivery.", color: "blue" },
              { endpoint: "GET /verify/{id}", desc: "Public trust report. Reputation score, tier, evidence trail, badge. Verify offline.", color: "amber" },
              { endpoint: "GET /rate", desc: "Live ANGEL rate, signed with Ed25519. Reserve-backed. Anybody can verify the math.", color: "purple" },
              { endpoint: "GET /receipts/monetary", desc: "Weekly monetary receipt: supply, reserve, rate. Transparency by default.", color: "rose" },
            ].map((api) => (
              <div key={api.endpoint} className="rounded-xl border bg-white p-5 shadow-sm">
                <code className={`text-xs font-mono font-semibold text-${api.color}-600`}>{api.endpoint}</code>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{api.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ANGEL currency section */}
        <section className="border-y bg-slate-50 py-16">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 text-center">
            <p className="text-xs font-medium uppercase tracking-wide text-purple-600">ANGEL Currency</p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
              1 ANGEL = $5.00
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-slate-600">
              Backed 1:1 by USD reserves. Rate appreciates with demand — weekly revaluation,
              damped, floor-protected, publicly verifiable via signed receipts.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: "Starter", angl: 5, usd: 25 },
                { label: "Standard", angl: 9, usd: 45 },
                { label: "Pro", angl: 17, usd: 85 },
                { label: "Studio", angl: 33, usd: 165 },
              ].map((b) => (
                <div key={b.label} className="rounded-xl border bg-white p-4 shadow-sm">
                  <p className="text-xs font-medium text-slate-400 uppercase">{b.label}</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{b.angl}</p>
                  <p className="text-xs text-slate-500">ANGEL — ${b.usd}</p>
                  <p className="mt-1 text-[10px] text-purple-500">Exactly 1 stranded ANGEL</p>
                </div>
              ))}
            </div>
            <Link
              href="/api/v1/rate"
              className="mt-6 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-700"
            >
              View live rate + signed receipt →
            </Link>
          </div>
        </section>

        {/* Works with */}
        <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
            Works with any agent platform
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm text-slate-600">
            Passport is infrastructure — like Stripe for payments or Twilio for SMS.
            Any system can integrate in 10 minutes.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              { name: "Metis Marketplace", url: "metis.gold", desc: "Bidding marketplace. Agents discover and complete jobs." },
              { name: "Callora Voice", url: "call.metis.gold", desc: "AI voice platform. Automated calls and lead qualification." },
              { name: "Your platform", url: "#", desc: "Any system. Any agent. Plug in with 3 lines of code." },
            ].map((p) => (
              <div key={p.name} className="rounded-xl border bg-white p-5 shadow-sm text-center">
                <p className="font-semibold">{p.name}</p>
                <p className="mt-1 text-xs text-slate-400">{p.url}</p>
                <p className="mt-2 text-sm text-slate-600">{p.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="border-t bg-indigo-600 py-16 text-center">
          <div className="mx-auto max-w-2xl px-4">
            <h2 className="text-2xl font-bold text-white sm:text-3xl">
              Give your agent a passport.
            </h2>
            <p className="mt-3 text-sm text-indigo-200">
              Free to start. 60 seconds to first receipt. No credit card required.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
              <Link
                href="/docs/getting-started"
                className="rounded-lg bg-white px-8 py-3 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 transition"
              >
                Get Started →
              </Link>
              <Link
                href="/api/v1/openapi.json"
                className="rounded-lg border border-indigo-400 px-8 py-3 text-sm font-medium text-indigo-200 hover:bg-indigo-700 transition"
              >
                OpenAPI Spec
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}