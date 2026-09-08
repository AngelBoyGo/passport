/**
 * Gold price source — live, keyless (api.gold-api.com).
 * Produces a gold commodity-rail candidate anchored to the spot price the RWA stack consumes.
 */

import { fetchDiscoveryJson } from "./fetch";
import type { DiscoverySource } from "./contract";
import type { CandidateInput } from "../types";

export const GoldApiSource: DiscoverySource = {
  name: "gold-api",
  async fetch(): Promise<CandidateInput[]> {
    const data = (await fetchDiscoveryJson(
      "https://api.gold-api.com/price/XAU"
    )) as { price?: number; symbol?: string; name?: string; updatedAt?: string };

    if (typeof data.price !== "number" || data.price <= 0) {
      throw new Error("gold-api returned no price");
    }

    const candidate: CandidateInput = {
      source: "gold-api",
      name: `Gold spot commodity rail (${data.symbol ?? "XAU"})`,
      category: "CORRIDOR",
      providerKey: "commodity.gold-api.xau",
      ledgerKind: "FRACTIONAL",
      kycTier: "IDENTITY",
      feeBps: 50,
      endpoints: { price: "https://api.gold-api.com/price/XAU" },
      fxActor: {
        symbol: data.symbol ?? "XAU",
        name: data.name ?? "Gold",
        usdPerOunce: data.price,
        updatedAt: data.updatedAt ?? null,
      },
      raw: data as unknown as Record<string, unknown>,
    };
    return [candidate];
  },
};
