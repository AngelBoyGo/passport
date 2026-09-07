import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reserves/assays — Query verified geochemical & spectrometry assay certifications.
 * POST /api/v1/reserves/assays — Ingest signed laboratory assay reports for vaulted lots.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:assays:get:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { searchParams } = new URL(request.url);
  const batchNumber = searchParams.get("batch_number") || searchParams.get("batch");
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.min(Number.parseInt(limitParam, 10), 100) : 50;

  try {
    const assays = await prisma.assayerCertification.findMany({
      where: batchNumber ? { batchNumber } : undefined,
      orderBy: { certifiedAt: "desc" },
      take: limit,
    });

    return NextResponse.json(
      {
        success: true,
        count: assays.length,
        assays: assays.map((a) => ({
          certification_number: a.certificationNumber,
          batch_number: a.batchNumber,
          assayer_name: a.assayerName,
          assayer_public_key: a.assayerPublicKey,
          methodology: a.methodology,
          purity_fineness: a.purityFineness,
          gross_grams: a.grossGrams,
          sample_signature: a.sampleSignature,
          notes: a.notes,
          certified_at: a.certifiedAt.toISOString(),
        })),
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

export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:assays:post:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  try {
    const body = await request.json();

    const certificationNumber = body.certification_number || body.certificationNumber;
    const assayerName = body.assayer_name || body.assayerName;
    const assayerPublicKey = body.assayer_public_key || body.assayerPublicKey;
    const batchNumber = body.batch_number || body.batchNumber;
    const methodology = body.methodology || "XRF_SPECTROMETRY";
    const purityFineness = Number(body.purity_fineness ?? body.purityFineness);
    const grossGrams = Number(body.gross_grams ?? body.grossGrams);
    const sampleSignature = body.sample_signature || body.sampleSignature;
    const notes = body.notes;

    if (
      !certificationNumber ||
      !assayerName ||
      !assayerPublicKey ||
      !batchNumber ||
      isNaN(purityFineness) ||
      isNaN(grossGrams) ||
      !sampleSignature
    ) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: certification_number, assayer_name, assayer_public_key, batch_number, purity_fineness, gross_grams, sample_signature",
        },
        { status: 400 }
      );
    }

    if (purityFineness <= 0 || purityFineness > 1.0) {
      return NextResponse.json(
        { error: "purity_fineness must be a decimal between 0.0001 and 1.0000" },
        { status: 400 }
      );
    }

    if (grossGrams <= 0) {
      return NextResponse.json({ error: "gross_grams must be positive" }, { status: 400 });
    }

    const certification = await prisma.assayerCertification.create({
      data: {
        certificationNumber,
        assayerName,
        assayerPublicKey,
        batchNumber,
        methodology,
        purityFineness,
        grossGrams,
        sampleSignature,
        notes: notes || null,
      },
    });

    return NextResponse.json(
      {
        success: true,
        certification: {
          certification_number: certification.certificationNumber,
          batch_number: certification.batchNumber,
          assayer_name: certification.assayerName,
          purity_fineness: certification.purityFineness,
          certified_at: certification.certifiedAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
