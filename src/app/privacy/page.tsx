import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm text-indigo-600 hover:underline">
        ← Passport
      </Link>
      <h1 className="mt-6 text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mt-1 text-sm text-slate-500">Last updated: August 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-slate-600">
        <Section title="What we store">
          <p>
            Passport stores only cryptographic commitments (SHA-256 hashes) of
            agent identity, repository names, branch names, session logs, and
            payload contents. Raw agent data, source code, and personal
            information are never stored.
          </p>
        </Section>

        <Section title="What we never store">
          <ul className="list-disc pl-5 space-y-1">
            <li>Private keys or seed phrases</li>
            <li>Raw agent payloads or source code</li>
            <li>Passwords (authentication is via API keys or cryptographic proof)</li>
            <li>IP addresses beyond rate-limiting windows</li>
            <li>Personal identifying information beyond Stripe customer IDs</li>
          </ul>
        </Section>

        <Section title="Stripe">
          <p>
            Payment processing is handled entirely by Stripe. Passport receives
            only the Stripe customer ID and subscription status. Full card
            details never reach our servers.
          </p>
        </Section>

        <Section title="Data retention">
          <p>
            Receipts and evidence commitments are stored indefinitely as part of
            the verifiable audit trail. Revoked receipts are marked as revoked
            but not deleted — revocation is a status change, not a deletion.
            Operators may delete API keys at any time via the dashboard.
          </p>
        </Section>

        <Section title="Third-party access">
          <p>
            We do not sell or share data with third parties. Evidence ingestion
            is opt-in and controlled per-source-type. The public key and masked
            public profiles are intentionally public by design — that is the
            product.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            For privacy questions, contact the operator at the domain
            registration contact for passport.metis.gold.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}