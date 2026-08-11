import { FeatureCard, FeatureGrid } from "./feature-card";

const receiptFeatures = [
  {
    icon: "🪪",
    title: "Agent Enrollment",
    description:
      "Proof-based identity via ed25519 challenge-response. Derive a unique subject commitment from public key + context. Issued passports are verifiable across sessions.",
  },
  {
    icon: "📜",
    title: "Signed Receipts",
    description:
      "Tamper-evident ed25519-signed receipts for every agent action. Issue pending, finalize with outcome. First-class refusals, timeouts, and failure tombstones.",
  },
  {
    icon: "🔗",
    title: "Domain-Scoped History",
    description:
      "Receipts chain within operator + domain scope. Blinded domain commitments protect privacy — the verifying key never leaks which domain issued the receipt.",
  },
  {
    icon: "🔍",
    title: "Public Verification",
    description:
      "Anyone can verify a receipt's signature using the published ed25519 key. Full chain integrity check against domain-scoped history. No trust required.",
  },
  {
    icon: "📊",
    title: "Evidence Ingestion",
    description:
      "Ingest behavioral evidence from 6 source types: GitHub push, commits, issues, OTel traces, compliance reports, and task deliverables. Normalized into 5 event types.",
  },
  {
    icon: "🔄",
    title: "Evidence Bridge",
    description:
      "Every ingested evidence event can auto-issue a signed custody receipt. Links raw observations to the verified receipt ledger. Opt-in via EVIDENCE_BRIDGE_OPERATOR_ID.",
  },
];

export function ReceiptFeaturesSection() {
  return (
    <FeatureGrid
      title="The Receipt System"
      subtitle="Tamper-evident, privacy-preserving behavioral receipts for AI agents. Signed by the verifier, verified by anyone."
    >
      {receiptFeatures.map((f) => (
        <FeatureCard key={f.title} {...f} />
      ))}
    </FeatureGrid>
  );
}