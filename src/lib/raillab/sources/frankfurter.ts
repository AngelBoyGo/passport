/**
 * Frankfurter (ECB) FX source — live, keyless.
 * Produces FX settlement-rail candidates (XOF=FCFA against USD and EUR), which are the
 * highest-frequency rails the Sahel on-ramp consumes.
 */

import { fetchDiscoveryJson } from "./fetch";
import type { DiscoverySource } from "./contract";
import type { CandidateInput } from "../types";

const BASE = "https://api.frankfurter.app";

async function fxCandidate(from: string, to: string, rate: number): Promise<CandidateInput> {
  return {
    source: "frankfurter",
    name: `FX ${from}/${to} settlement`,
    category: "PAYMENT",
    providerKey: `fx.frankfurter.${from.toLowerCase()}.${to.toLowerCase()}`,
    ledgerKind: "STATE",
    kycTier: "NONE",
    feeBps: 10,
    endpoints: { latest: `${BASE}/latest?from=${from}&to=${to}` },
    fxActor: { from, to, rate, timestamp: new Date().toISOString() },
    raw: { from, to, rate },
  };
}

export const FrankfurterSource: DiscoverySource = {
  name: "frankfurter",
  async fetch(): Promise<CandidateInput[]> {
    const usdXof = (await fetchDiscoveryJson(
      `${BASE}/latest?from=USD&to=XOF`
    )) as { rates?: Record<string, number> };
    const eurXof = (await fetchDiscoveryJson(
      `${BASE}/latest?from=EUR&to=XOF`
    )) as { rates?: Record<string, number> };

    const candidates: CandidateInput[] = [];
    const usdRate = usdXof.rates?.XOF;
    const eurRate = eurXof.rates?.XOF;
    if (typeof usdRate === "number" && usdRate > 0) {
      candidates.push(await fxCandidate("USD", "XOF", usdRate));
    }
    if (typeof eurRate === "number" && eurRate > 0) {
      candidates.push(await fxCandidate("EUR", "XOF", eurRate));
    }
    return candidates;
  },
};
