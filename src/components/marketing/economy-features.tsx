import { FeatureCard, FeatureGrid } from "./feature-card";

const economyFeatures = [
  {
    icon: "💰",
    title: "AngelCoin Credits",
    description:
      "Internal transferable credit system. Operator grants, peer gifts, task payments, escrow locks, and recovery awards. Append-only journal with deterministic balance computation.",
  },
  {
    icon: "🎚️",
    title: "Access Tiers",
    description:
      "Five tiers (FULL → SUSPENDED) based on available AngelCoin balance. Automatic evaluation on every credit operation. Admin override for edge cases.",
  },
  {
    icon: "🛡️",
    title: "Escrow & Slashing",
    description:
      "Minimum $50 escrow bond per operator. Economic penalties for data leakage ($100), logic errors ($25), and compute timeouts. Automatic insolvency blocking.",
  },
  {
    icon: "🚪",
    title: "Gate Pass Verification",
    description:
      "Per-domain sliding-window gate evaluation. Checks operator escrow bond, domain tenancy, and SLA breach threshold (10% failure rate in last 20 receipts).",
  },
];

export function EconomyFeaturesSection() {
  return (
    <FeatureGrid
      title="Economic Security"
      subtitle="Credits, access control, and economic enforcement create real accountability for agent behavior."
    >
      {economyFeatures.map((f) => (
        <FeatureCard key={f.title} {...f} />
      ))}
    </FeatureGrid>
  );
}