/**
 * GitHub registry source — live, keyless (api.github.com search).
 * Scrapes real public registries for mobile-money / PAYG / agri-API projects and surfaces
 * them as directory-rail candidates. Rate-limited by GitHub (unauthenticated), which is a
 * real kink the factory must tolerate and log.
 */

import { fetchDiscoveryJson } from "./fetch";
import type { DiscoverySource } from "./contract";
import type { CandidateInput } from "../types";

const QUERIES = ["mobile+money+api", "payg+solar+api", "agri+commodity+api"];
const PER_QUERY = 5;

export const GitHubDirectorySource: DiscoverySource = {
  name: "github-directory",
  async fetch(): Promise<CandidateInput[]> {
    const candidates: CandidateInput[] = [];
    for (const q of QUERIES) {
      const url = `https://api.github.com/search/repositories?q=${q}&per_page=${PER_QUERY}&sort=stars`;
      const data = (await fetchDiscoveryJson(url)) as {
        items?: Array<{
          full_name: string;
          description: string | null;
          html_url: string;
          stargazers_count: number;
        }>;
      };
      for (const item of data.items ?? []) {
        candidates.push({
          source: "github-directory",
          name: item.full_name,
          category: "PAYMENT",
          providerKey: `directory.github.${item.full_name.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`,
          ledgerKind: "ANGEL",
          kycTier: "NONE",
          feeBps: 25,
          endpoints: { docs: item.html_url },
          raw: {
            description: item.description ?? "",
            stars: item.stargazers_count,
            url: item.html_url,
          },
        });
      }
    }
    return candidates;
  },
};
