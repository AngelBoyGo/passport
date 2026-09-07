import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reserves/vaults — Sovereign Bullion Vault Registry across the Sahel Confederation.
 *
 * Returns list of certified physical storage vaults, active batch counts,
 * and aggregated fine gold reserves.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:vaults:get:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  try {
    const batches = await prisma.vaultBatch.findMany({
      where: { status: "AUDITED" },
      orderBy: { vaultId: "asc" },
    });

    // Group by vaultId
    const vaultsMap = new Map<
      string,
      {
        vault_id: string;
        custodian_name: string;
        location_city: string;
        location_country: string;
        active_batches_count: number;
        total_fine_grams: number;
        total_gross_grams: number;
        status: "ACTIVE" | "MAINTENANCE" | "INACTIVE";
        last_audited_at: string | null;
      }
    >();

    for (const b of batches) {
      const existing = vaultsMap.get(b.vaultId);
      if (!existing) {
        vaultsMap.set(b.vaultId, {
          vault_id: b.vaultId,
          custodian_name: b.custodianName,
          location_city: b.locationCity,
          location_country: b.locationCountry,
          active_batches_count: 1,
          total_fine_grams: Number(b.fineWeightGrams.toFixed(4)),
          total_gross_grams: Number(b.grossWeightGrams.toFixed(4)),
          status: "ACTIVE",
          last_audited_at: b.auditedAt ? b.auditedAt.toISOString() : null,
        });
      } else {
        existing.active_batches_count += 1;
        existing.total_fine_grams = Number(
          (existing.total_fine_grams + b.fineWeightGrams).toFixed(4)
        );
        existing.total_gross_grams = Number(
          (existing.total_gross_grams + b.grossWeightGrams).toFixed(4)
        );
        if (b.auditedAt && (!existing.last_audited_at || new Date(b.auditedAt) > new Date(existing.last_audited_at))) {
          existing.last_audited_at = b.auditedAt.toISOString();
        }
      }
    }

    const vaults = Array.from(vaultsMap.values());

    return NextResponse.json(
      {
        success: true,
        total_vaults: vaults.length,
        vaults,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
