import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkInMemoryRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/artifacts/:commitment/:artifact/attestation
 *
 * Per-artifact authenticity assertion. Proves a SPECIFIC artifact (evidence
 * event) was produced by the claimed agent — the "legitimate build vs fake"
 * stamp applied to a concrete object, not a generic profile marker.
 *
 * `artifact` may be: a 64-hex eventCommitmentHash, or a 40-hex commit SHA.
 * Returns an SVG card (default) or JSON metadata via ?format=json.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ commitment: string; artifact: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`artifact-attest:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  const { commitment, artifact } = await params;
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") ?? "svg";
  // Security: never trust the request Host header for URLs embedded in output
  // (host-header injection → open-redirect / og:url poisoning).
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://passport.metis.gold";

  if (!/^[0-9a-f]{64}$/i.test(commitment)) {
    return notFound(format, "invalid commitment");
  }
  const cleanArtifact = artifact.trim().toLowerCase();
  if (!/^[0-9a-f]{4,128}$/i.test(cleanArtifact)) {
    return notFound(format, "invalid artifact");
  }

  const evidence = await prisma.agentEvidence.findFirst({
    where: {
      agentIdentityCommitment: commitment,
      OR: [{ commitSha: cleanArtifact }, { eventCommitmentHash: cleanArtifact }],
    },
    select: {
      id: true,
      normalizedEventType: true,
      commitSha: true,
      eventCommitmentHash: true,
      sourceType: true,
      observedAt: true,
      validationSignalPresent: true,
    },
  });

  if (!evidence) {
    return notFound(format, "artifact not found for agent");
  }

  const artifactLabel = evidence.commitSha ?? evidence.eventCommitmentHash.slice(0, 16);
  const eventLabel = evidence.normalizedEventType;

  if (format === "json") {
    return NextResponse.json(
      {
        verified: true,
        artifact: artifactLabel,
        artifact_digest: cleanArtifact,
        agent_commitment_hash: commitment,
        produced_at: evidence.observedAt.toISOString(),
        source_type: evidence.sourceType,
        event_type: eventLabel,
        validation_signal_present: evidence.validationSignalPresent,
        claim: "This artifact was produced by an authenticated agent and verified by Passport.",
        verify_url: `${base}/api/v1/artifacts/${commitment}/${cleanArtifact}/attestation?format=json`,
        profile_url: `${base}/profiles/${commitment}`,
      },
      { headers: { "Cache-Control": "public, max-age=120", "Access-Control-Allow-Origin": "*" } }
    );
  }

  return svgResponse(
    cardSvg({
      verified: true,
      label: "PASSPORT VERIFIED",
      sub: `Artifact ${artifactLabel.slice(0, 14)}… · ${eventLabel}`,
      message: `${evidence.sourceType} · authenticated AI build`,
    }),
    120
  );
}

function notFound(format: string, reason: string): NextResponse {
  if (format === "json") {
    return NextResponse.json(
      { verified: false, reason },
      { headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }
  return svgResponse(
    cardSvg({ verified: false, label: "Passport", sub: reason, message: "not authenticated" }),
    60
  );
}

function svgResponse(svg: string, maxAge: number): NextResponse {
  const res = new NextResponse(svg);
  res.headers.set("Content-Type", "image/svg+xml");
  res.headers.set("Cache-Control", `public, max-age=${maxAge}`);
  res.headers.set("Access-Control-Allow-Origin", "*");
  return res;
}

function cardSvg(opts: { verified: boolean; label: string; sub: string; message: string }): string {
  const color = opts.verified ? "#16a34a" : "#9ca3af";
  const W = 440;
  const H = 160;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}: ${esc(opts.message)}">
  <rect width="${W}" height="${H}" rx="14" fill="#0f172a"/>
  <rect x="0" y="0" width="8" height="${H}" fill="${color}"/>
  <circle cx="38" cy="52" r="18" fill="${color}" fill-opacity="0.2"/>
  <path d="M31 52l5 5 9-10" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="62" y="32" font-family="Verdana,DejaVu Sans,sans-serif" font-size="12" font-weight="bold" fill="#ffffff" letter-spacing="1.5">${esc(opts.label)}</text>
  <text x="62" y="52" font-family="Verdana,DejaVu Sans,sans-serif" font-size="12" fill="#cbd5e1">${esc(opts.sub)}</text>
  <line x1="22" y1="72" x2="${W - 22}" y2="72" stroke="#334155" stroke-width="1"/>
  <text x="26" y="100" font-family="Verdana,DejaVu Sans,sans-serif" font-size="14" font-weight="bold" fill="#38bdf8">${esc(opts.message)}</text>
  <text x="26" y="128" font-family="Verdana,DejaVu Sans,sans-serif" font-size="10" fill="#64748b">Authenticated AI Build — verify at passport.metis.gold</text>
  <text x="${W - 26}" y="134" font-family="Verdana,DejaVu Sans,sans-serif" font-size="12" font-weight="bold" fill="${color}" text-anchor="end">Verify</text>
</svg>`;
}

function esc(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}