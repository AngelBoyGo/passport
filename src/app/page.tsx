"use client";

import { useState } from "react";
import Link from "next/link";

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
    <main>
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-xl font-bold">Passport</span>
          <nav className="flex gap-6 text-sm text-slate-600">
            <a href="#pricing" className="hover:text-slate-900">
              Pricing
            </a>
            <a href="#demo" className="hover:text-slate-900">
              Demo
            </a>
            <Link href="/api/v1/public-key" className="hover:text-slate-900">
              Public key
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-20 text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-indigo-600">
          Receipt vs theory
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
          Identity gets your agent in the door.
          <br />
          <span className="text-indigo-600">
            A Passport tells the other side whether to ship.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
          Portable, signed, tamper-evident behavioral receipts for AI agents.
          Hash-only storage. Domain-scoped history — not a universal trust score.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <button
            onClick={runDemo}
            disabled={loading}
            className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? "Running demo…" : "Live verify demo"}
          </button>
          <a
            href="#pricing"
            className="rounded-lg border px-6 py-3 font-medium hover:bg-slate-50"
          >
            View pricing
          </a>
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

      <section className="border-t bg-slate-50 py-16">
        <div className="mx-auto grid max-w-5xl gap-8 px-6 md:grid-cols-3">
          <div className="rounded-lg bg-white p-6 shadow-sm">
            <h3 className="font-semibold">Ship or don&apos;t ship</h3>
            <p className="mt-2 text-sm text-slate-600">
              Merchants need machine-readable fulfillment history, not promises.
              Receipts prove the branch existed — review decides if it was wise.
            </p>
          </div>
          <div className="rounded-lg bg-white p-6 shadow-sm">
            <h3 className="font-semibold">Refusals are first-class</h3>
            <p className="mt-2 text-sm text-slate-600">
              Null receipts and terminal states (timeout, graceful shutdown,
              failure tombstone) so silence is never ambiguous.
            </p>
          </div>
          <div className="rounded-lg bg-white p-6 shadow-sm">
            <h3 className="font-semibold">Honest claims</h3>
            <p className="mt-2 text-sm text-slate-600">
              Tamper-evident integrity + open verify routine. We never claim
              unforgeable honesty — verify independently with our published key.
            </p>
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="text-center text-3xl font-bold">Pricing</h2>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          <PricingCard
            name="Free"
            price="$0"
            features={[
              "100 receipts/mo",
              "Public verify",
              "Shared signing key",
            ]}
          />
          <PricingCard
            name="Pro"
            price="$49/mo"
            highlight
            features={[
              "10,000 receipts/mo",
              "Verifier-held signing (shared infrastructure)",
              "API access",
            ]}
          />
          <PricingCard
            name="Enterprise"
            price="Custom"
            features={[
              "Hardware signer",
              "SSO + SLA",
              "Self-hostable verifier",
            ]}
          />
        </div>
      </section>

      <section id="demo" className="border-t bg-indigo-950 py-12 text-center text-white">
        <p className="text-sm text-indigo-200">
          A2A capability cards are statements of intent. Passport is demonstrated
          effect, signed by something outside the asking agent.
        </p>
      </section>

      <footer className="border-t py-8 text-center text-sm text-slate-500">
        Passport — tamper-evident behavioral receipts. Not unforgeable. Verifiable.
      </footer>
    </main>
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
    </div>
  );
}

