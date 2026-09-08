/**
 * Rail discovery orchestrator (Phase 19).
 *
 * Runs every registered live source, normalizes to RailCandidate, dedupes by content-hash
 * fingerprint (unique-key upsert — a re-seen candidate is a no-op), and records per-source
 * failures as real telemetry so a dead feed is a surfaced kink, never a silent zero.
 */

import { prisma } from "@/lib/db";
import { canonicalJson, sha256Hex } from "@/lib/receipt/canonical";
import { DISCOVERY_SOURCES } from "./sources";
import type { DiscoverySource } from "./sources";
import type { CandidateInput } from "./types";

export function fingerprintCandidate(input: CandidateInput): string {
  const normalized: Record<string, unknown> = {
    source: input.source,
    name: input.name,
    category: input.category,
    providerKey: input.providerKey,
    ledgerKind: input.ledgerKind,
    kycTier: input.kycTier,
    feeBps: input.feeBps,
    endpoints: input.endpoints ?? null,
    idempotencyKeyPath: input.idempotencyKeyPath ?? null,
    fxActor: input.fxActor ?? null,
  };
  return sha256Hex(canonicalJson(normalized));
}

export interface DiscoveryResult {
  scanned: number;
  created: number;
  skippedDuplicates: number;
  sourceErrors: Array<{ source: string; error: string }>;
}

export async function runDiscovery(
  sources: DiscoverySource[] = DISCOVERY_SOURCES
): Promise<DiscoveryResult> {
  let created = 0;
  let skippedDuplicates = 0;
  const sourceErrors: Array<{ source: string; error: string }> = [];

  for (const source of sources) {
    let inputs: CandidateInput[];
    try {
      inputs = await source.fetch();
    } catch (err) {
      sourceErrors.push({
        source: source.name,
        error: err instanceof Error ? err.message : String(err),
      });
      // Record the source failure as a telemetry event so the loop can see it.
      await prisma.railTelemetry
        .create({
          data: {
            railKey: `source:${source.name}`,
            errorTranche: "SLA_BREACH",
            settlementCount: 0,
          },
        })
        .catch(() => null);
      continue;
    }

    for (const input of inputs) {
      const fingerprint = fingerprintCandidate(input);
      try {
        const existing = await prisma.railCandidate.findUnique({ where: { fingerprint } });
        if (existing) {
          skippedDuplicates++;
          continue;
        }
        await prisma.railCandidate.create({
          data: {
            fingerprint,
            source: input.source,
            payload: (input.raw ?? (input as unknown as Record<string, unknown>)) as any,
          },
        });
        created++;
      } catch (err) {
        // Unique-constraint race → treat as duplicate.
        if (err instanceof Error && /unique|constraint/i.test(err.message)) {
          skippedDuplicates++;
        } else {
          sourceErrors.push({
            source: source.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  return { scanned: sources.length, created, skippedDuplicates, sourceErrors };
}
