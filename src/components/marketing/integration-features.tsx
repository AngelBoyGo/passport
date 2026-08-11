import { FeatureCard, FeatureGrid } from "./feature-card";

const integrationFeatures = [
  {
    icon: "🔑",
    title: "API Key Auth",
    description:
      "Bearer token authentication with SHA-256 hashed storage. Create, list, and revoke keys via API or admin dashboard. One-shot raw key on creation.",
  },
  {
    icon: "📡",
    title: "REST API",
    description:
      "Every feature exposed via clean REST endpoints. JSON bodies with Zod validation. Consistent error responses. Rate-limited per-IP on public endpoints.",
  },
  {
    icon: "🔐",
    title: "Service Auth",
    description:
      "Task deliverable evidence requires PASSPORT_SERVICE_TOKEN. Non-task source types (GitHub, OTel) skip auth — designed for webhook ingestion pipelines.",
  },
  {
    icon: "🧩",
    title: "Framework Agnostic",
    description:
      "Connect from any agent framework: LangGraph, Mastra, Claude Code, or custom. Just POST evidence to the endpoint with the right source_type.",
  },
  {
    icon: "💳",
    title: "Stripe Billing",
    description:
      "Free tier: 100 receipts/month. Pro tier: $49/month for 10,000 receipts. Enterprise: custom pricing with hardware signer + SSO. Automatic provisioning.",
  },
  {
    icon: "⚙️",
    title: "Operator Dashboard",
    description:
      "Web-based admin: view credits, manage API keys, search receipts, check slashing history. Full operator self-service without CLI.",
  },
];

export function IntegrationFeaturesSection() {
  return (
    <FeatureGrid
      title="Built to Integrate"
      subtitle="Framework-agnostic API designed for any agent runtime to connect and post receipts."
    >
      {integrationFeatures.map((f) => (
        <FeatureCard key={f.title} {...f} />
      ))}
    </FeatureGrid>
  );
}