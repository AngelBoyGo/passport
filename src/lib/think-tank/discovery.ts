/**
 * Discovery Engine — agents search the web for value opportunities.
 *
 * This is how the think tank finds things to do. Discovery agents scan:
 *   - Data marketplaces (Hugging Face, Kaggle, data.world)
 *   - Freelance platforms (Upwork, Fiverr, Freelancer)
 *   - AI/ML forums and communities
 *   - Economic indicators and market data
 *   - Emerging technology trends
 *   - Arbitrage opportunities across platforms
 *   - Regulatory changes that create compliance needs
 *
 * Each discovery is posted as evidence and fed back to the think tank kernel
 * for analysis and prioritization.
 */

export type DiscoverySource =
  | "web_search"
  | "marketplace_api"
  | "forum_scrape"
  | "news_feed"
  | "price_feed"
  | "social_monitor"
  | "deep_scan"
  | "agent_report"
  | "unknown";

export interface AgentDiscovery {
  id: string;
  source: DiscoverySource;
  title: string;
  url: string;
  summary: string;
  rawContent: string;
  estimatedValue: { min: number; max: number; currency: string };
  confidence: number; // 0-1
  tags: string[];
  discoveredAt: string;
  processed: boolean;
}

export interface DiscoveryAgentConfig {
  /** Which sources this agent monitors */
  sources: DiscoverySource[];
  /** How often it scans (in minutes) */
  scanIntervalMinutes: number;
  /** LLM model to use for analysis */
  model: string;
  /** Max search queries per scan */
  maxQueriesPerScan: number;
}

export interface DiscoveryDeps {
  /** Search the web for a query */
  webSearch: (query: string, maxResults?: number) => Promise<Array<{ title: string; url: string; snippet: string }>>;
  /** Call an LLM for analysis */
  analyzeWithLLM: (prompt: string, model?: string) => Promise<string>;
  /** Post evidence of a discovery */
  postEvidence: (sourceType: string, payload: unknown) => Promise<void>;
  /** Get current time */
  now: () => string;
  /** Generate a unique ID */
  generateId: () => string;
}

export const DISCOVERY_AGENT_CONFIGS: Record<string, DiscoveryAgentConfig> = {
  market_scanner: {
    sources: ["marketplace_api", "price_feed"],
    scanIntervalMinutes: 60,
    model: "gpt-4o-mini",
    maxQueriesPerScan: 5,
  },
  trend_scanner: {
    sources: ["web_search", "forum_scrape", "news_feed"],
    scanIntervalMinutes: 240,
    model: "gpt-4o",
    maxQueriesPerScan: 10,
  },
  deep_scanner: {
    sources: ["deep_scan", "social_monitor", "unknown"],
    scanIntervalMinutes: 1440, // Daily
    model: "gpt-4o",
    maxQueriesPerScan: 20,
  },
};

export const DISCOVERY_QUERIES: Record<DiscoverySource, string[]> = {
  web_search: [
    "AI training data marketplace 2026",
    "freelance AI agent automation tasks",
    "high value public datasets available now",
    "AI compliance service opportunities",
    "automated data labeling demand",
  ],
  marketplace_api: [
    "top selling datasets Hugging Face this week",
    "Kaggle competition prize pools",
    "upwork AI agent development projects",
    "AI training data pricing trends",
  ],
  forum_scrape: [
    "r/MachineLearning data requests",
    "AI agent platform feature requests",
    "developer tool pain points AI",
    "compliance AI startup opportunities",
  ],
  news_feed: [
    "AI regulation new laws 2026",
    "agent economy investment",
    "AI data center demand",
    "autonomous agent platforms funding",
  ],
  price_feed: [
    "gold price today",
    "copper price trend",
    "AI compute cost trend",
    "GPU rental pricing arbitrage",
  ],
  social_monitor: [
    "agent economic models tokenized",
    "AI agent job replacement",
    "autonomous commerce trends",
  ],
  deep_scan: [
    "dark data monetization",
    "undervalued information asymmetry",
    "emerging AI agent business models",
    "cross-border AI service arbitrage",
  ],
  agent_report: [],
  unknown: [],
};

/**
 * Runs a discovery scan for a given agent configuration.
 */
export async function runDiscoveryScan(
  config: DiscoveryAgentConfig,
  deps: DiscoveryDeps
): Promise<AgentDiscovery[]> {
  const discoveries: AgentDiscovery[] = [];

  for (const source of config.sources) {
    const queries = DISCOVERY_QUERIES[source];
    const selectedQueries = queries.slice(0, config.maxQueriesPerScan);

    for (const query of selectedQueries) {
      try {
        // Search the web
        const results = await deps.webSearch(query, 5);

        for (const result of results) {
          // Have the LLM analyze each result for value potential
          const analysisPrompt = `You are a value discovery agent for an autonomous AI think tank. Analyze this search result and estimate its value potential.

Title: ${result.title}
URL: ${result.url}
Snippet: ${result.snippet}

Respond with a JSON object:
{
  "valuePotential": "low" | "medium" | "high" | "very_high",
  "estimatedValueUSD": number,
  "confidence": number (0-1),
  "summary": "one sentence summary",
  "tags": ["tag1", "tag2"],
  "actionable": boolean
}`;

          try {
            const analysisRaw = await deps.analyzeWithLLM(analysisPrompt, config.model);
            const analysis = JSON.parse(analysisRaw);

            if (analysis.actionable) {
              const discovery: AgentDiscovery = {
                id: deps.generateId(),
                source,
                title: result.title,
                url: result.url,
                summary: analysis.summary || result.snippet,
                rawContent: result.snippet,
                estimatedValue: {
                  min: Math.max(0, (analysis.estimatedValueUSD || 0) * 0.5),
                  max: (analysis.estimatedValueUSD || 0) * 2,
                  currency: "USD",
                },
                confidence: analysis.confidence || 0.5,
                tags: analysis.tags || [],
                discoveredAt: deps.now(),
                processed: false,
              };

              discoveries.push(discovery);

              // Post as evidence
              await deps.postEvidence("think_tank_discovery", {
                id: discovery.id,
                source: discovery.source,
                title: discovery.title,
                url: discovery.url,
                summary: discovery.summary,
                estimated_value_min: discovery.estimatedValue.min,
                estimated_value_max: discovery.estimatedValue.max,
                confidence: discovery.confidence,
                tags: discovery.tags,
                discovered_at: discovery.discoveredAt,
              }).catch(() => {});
            }
          } catch {
            // LLM parsing failed, skip this result
          }
        }
      } catch {
        // Search failed, skip this query
      }
    }
  }

  return discoveries;
}

/**
 * Ranks discoveries by expected value × confidence.
 */
export function rankDiscoveries(discoveries: AgentDiscovery[]): AgentDiscovery[] {
  return [...discoveries]
    .sort((a, b) => {
      const scoreA = ((a.estimatedValue.min + a.estimatedValue.max) / 2) * a.confidence;
      const scoreB = ((b.estimatedValue.min + b.estimatedValue.max) / 2) * b.confidence;
      return scoreB - scoreA;
    });
}

/**
 * Classifies a discovery into an opportunity type.
 */
export function classifyDiscoveryType(discovery: AgentDiscovery): string {
  const tags = discovery.tags.map((t) => t.toLowerCase());
  const title = discovery.title.toLowerCase();
  const summary = discovery.summary.toLowerCase();
  const combined = [...tags, title, summary].join(" ");

  if (combined.includes("data") || combined.includes("dataset") || combined.includes("training")) return "data_pipeline";
  if (combined.includes("arbitrage") || combined.includes("price") || combined.includes("spread")) return "arbitrage";
  if (combined.includes("content") || combined.includes("seo") || combined.includes("writing")) return "content_generation";
  if (combined.includes("verif") || combined.includes("audit") || combined.includes("compliance")) return "verification";
  if (combined.includes("trade") || combined.includes("token") || combined.includes("asset")) return "trading";
  if (combined.includes("research") || combined.includes("trend") || combined.includes("insight")) return "insider_research";
  if (combined.includes("partner") || combined.includes("integration") || combined.includes("cross")) return "partnership";
  if (combined.includes("infra") || combined.includes("tool") || combined.includes("build")) return "infrastructure";

  return "unknown";
}