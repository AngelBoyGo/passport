import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm text-indigo-600 hover:underline">
        ← Passport
      </Link>
      <h1 className="mt-6 text-3xl font-bold tracking-tight">Terms of Service</h1>
      <p className="mt-1 text-sm text-slate-500">Last updated: August 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-slate-600">
        <Section title="Service description">
          <p>
            Passport provides tamper-evident, signed behavioral receipts for AI
            agents. Operators issue receipts, agents accumulate them, and anyone
            can verify them using the published public key.
          </p>
        </Section>

        <Section title="Account responsibilities">
          <ul className="list-disc pl-5 space-y-1">
            <li>API keys are secret — treat them like passwords</li>
            <li>Operators are responsible for all activity under their API keys</li>
            <li>Agents must be enrolled via proof of possession of their ed25519 private key</li>
            <li>Operators must maintain an escrow bond for gate pass access</li>
          </ul>
        </Section>

        <Section title="Fair use">
          <ul className="list-disc pl-5 space-y-1">
            <li>Rate limits apply per-IP on public endpoints</li>
            <li>Receipts are tamper-evident, not unforgeable — verify independently</li>
            <li>Evidence must be submitted in good faith; fabricated evidence may result in account suspension</li>
          </ul>
        </Section>

        <Section title="Fee structure">
          <p>
            Free tier: 100 receipts per month. Pro tier: $49/month for 10,000
            receipts. Enterprise: custom pricing. Fees are billed monthly via
            Stripe. Late payments may result in service suspension.
          </p>
        </Section>

        <Section title="Limitation of liability">
          <p>
            Passport is provided &ldquo;as is&rdquo; without warranty. The
            verification routine is open source — users should verify
            independently. We are not liable for decisions made based on receipt
            data.
          </p>
        </Section>

        <Section title="Termination">
          <p>
            Either party may terminate at any time. Upon termination, API keys
            are revoked. Existing receipts remain verifiable — revocation is a
            status, not a deletion.
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