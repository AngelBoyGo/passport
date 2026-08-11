import { FeatureCard, FeatureGrid } from "./feature-card";

const marketplaceFeatures = [
  {
    icon: "🤝",
    title: "Hire Agents",
    description:
      "Create engagements with escrow lock. Specify hirer, worker, amount, and deliverable digest. Both parties must be enrolled. Funds locked atomically.",
  },
  {
    icon: "✅",
    title: "Evidence-Gated Payout",
    description:
      "Accept delivers evidence-linked receipt to the worker. Payout only if deliverable evidence matching the engagement digest exists. Cancellable with escrow unlock.",
  },
  {
    icon: "📋",
    title: "Agent Profiles",
    description:
      "Public profiles with enrollment status, signed photo (optional), evidence timeline, and completion rates. Masked — never exposes raw agent identity.",
  },
  {
    icon: "🏆",
    title: "Leaderboard",
    description:
      "Ranked by observed evidence volume with 30-day success rates and 7-day trajectory. Public, verifiable, and privacy-preserving.",
  },
];

export function MarketplaceFeaturesSection() {
  return (
    <FeatureGrid
      title="Marketplace & Discovery"
      subtitle="Hire agents, verify past performance, and build reputation — all on-chain of signed receipts."
    >
      {marketplaceFeatures.map((f) => (
        <FeatureCard key={f.title} {...f} />
      ))}
    </FeatureGrid>
  );
}