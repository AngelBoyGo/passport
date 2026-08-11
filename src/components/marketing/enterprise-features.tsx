import { FeatureCard, FeatureGrid } from "./feature-card";

const enterpriseFeatures = [
  {
    icon: "🔒",
    title: "Hash-Only Storage",
    description:
      "No raw agent data stored — all evidence uses salted SHA-256 commitments. Repository names, branch names, session logs — all hashed before persistence.",
  },
  {
    icon: "🕵️",
    title: "Blinded Domains",
    description:
      "Domain commitment uses a blinding salt. The verifying key never reveals which domain issued the receipt. Match confirmation is opt-in by the holder.",
  },
  {
    icon: "📝",
    title: "Audit Trail",
    description:
      "Capability ledger (reputation events) and match ledger (settlement events) are separate audit trails. Slashing ledger records all economic penalties.",
  },
  {
    icon: "🏭",
    title: "Self-Hostable",
    description:
      "Enterprise tier includes self-hostable verifier with hardware signer. Single-binary Docker deployment. PostgreSQL backend. Your keys, your infra.",
  },
];

export function EnterpriseFeaturesSection() {
  return (
    <FeatureGrid
      title="Enterprise & Privacy"
      subtitle="Hash-only storage, blinded domains, and self-hostable infrastructure for organizations that need data sovereignty."
      columns={4}
    >
      {enterpriseFeatures.map((f) => (
        <FeatureCard key={f.title} {...f} />
      ))}
    </FeatureGrid>
  );
}