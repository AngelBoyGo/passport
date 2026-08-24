import { NextRequest, NextResponse } from "next/server";
import { getAgentProfile } from "@/lib/public-portal/portal-service";
import { checkInMemoryRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/badge/:hash/attestation — shareable "Passport Verified" card.
 *
 * The authenticity marker: "This AI build / artifact / agent is authenticated by
 * Passport — not an impostor." Returns a readable, embeddable, OG-safe SVG card
 * (fixed aspect ratio) showing: verified status, archetype, live evidence count,
 * artifact count, commitment fingerprint, first/last seen, and a verify CTA.
 * `?format=json` returns structured metadata for crawl/share.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`attestation:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  const { hash } = await params;
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") ?? "svg";
  // Security: hard-code the public origin; never derive from the request Host
  // header (host-header injection → open-redirect/Og:url poisoning).
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://passport.metis.gold";

  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    if (format === "json") {
      return NextResponse.json({ verified: false, reason: "invalid" }, { headers: cors() });
    }
    return svgResponse(cardSvg({ verified: false, label: "Passport", message: "invalid hash" }), 60);
  }

  const profile = await getAgentProfile(hash);

  if (!profile || !profile.totals) {
    if (format === "json") {
      return NextResponse.json({ verified: false, reason: "not_found" }, { headers: cors() });
    }
    return svgResponse(cardSvg({ verified: false, label: "Passport", message: "not found" }), 60);
  }

  const verified = profile.enrollment_status === "ENROLLED";
  const count = profile.totals.evidence_count ?? 0;
  const artifacts = profile.totals.artifact_count ?? 0;
  const short = `${hash.slice(0, 8)}…${hash.slice(-8)}`;

  if (format === "json") {
    return NextResponse.json(
      {
        verified,
        archetype: profile.archetype ?? "Agent",
        evidence_count: count,
        artifact_count: artifacts,
        commitment: hash,
        short,
        profile_url: `${base}/profiles/${hash}`,
        verify_url: `${base}/api/v1/badge/${hash}/attestation?format=json`,
        first_observed_at: profile.first_observed_at ?? null,
        last_observed_at: profile.last_observed_at ?? null,
        claim: "Authenticated AI build — verified by Passport",
      },
      { headers: { "Cache-Control": "public, max-age=120", ...cors() } }
    );
  }

  if (format === "html") {
    const title = verified ? "Passport Verified — Authenticated AI Build" : "Passport Enrolled";
    const desc = `${profile.archetype ?? "Agent"} · ${count} signed receipts · ${artifacts} artifacts · authenticated by Passport.`;
    const html = `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<meta property="og:type" content="profile"/>
<meta property="og:title" content="${escapeHtml(title)}"/>
<meta property="og:description" content="${escapeHtml(desc)}"/>
<meta property="og:image" content="${base}/api/v1/badge/${hash}/attestation"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(title)}"/>
<meta name="twitter:image" content="${base}/api/v1/badge/${hash}/attestation"/>
<link rel="canonical" href="${base}/profiles/${hash}"/>
<meta http-equiv="refresh" content="0;url=${base}/profiles/${hash}"/>
</head><body><p>${escapeHtml(desc)}</p></body></html>`;
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", ...cors() },
    });
  }

  return svgResponse(
    cardSvg({
      verified,
      label: verified ? "PASSPORT VERIFIED" : "PASSPORT ENROLLED",
      sub: `${profile.archetype ?? "Agent"} · ${short}`,
      message: `${count} signed receipt${count !== 1 ? "s" : ""} · ${artifacts} artifact${artifacts !== 1 ? "s" : ""}`,
    }),
    120
  );
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function svgResponse(svg: string, maxAge: number): NextResponse {
  const res = new NextResponse(svg);
  res.headers.set("Content-Type", "image/svg+xml");
  res.headers.set("Cache-Control", `public, max-age=${maxAge}`);
  res.headers.set("Access-Control-Allow-Origin", "*");
  return res;
}

function cardSvg(opts: {
  verified: boolean;
  label: string;
  sub?: string;
  message: string;
}): string {
  const color = opts.verified ? "#16a34a" : "#3b82f6";
  const W = 420;
  const H = 160;
  const sub = opts.sub && opts.sub.length > 0 ? opts.sub : "—";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}: ${esc(opts.message)}">
  <rect width="${W}" height="${H}" rx="14" fill="#0f172a"/>
  <rect x="0" y="0" width="8" height="${H}" fill="${color}"/>
  <circle cx="38" cy="52" r="18" fill="${color}" fill-opacity="0.2"/>
  <path d="M30 52l5 5 10-11" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="68" y="34" font-family="Verdana,DejaVu Sans,sans-serif" font-size="13" font-weight="bold" fill="#ffffff" letter-spacing="1.5">${esc(opts.label)}</text>
  <text x="68" y="58" font-family="Verdana,DejaVu Sans,sans-serif" font-size="13" fill="#cbd5e1">${esc(sub)}</text>
  <line x1="24" y1="78" x2="${W - 24}" y2="78" stroke="#334155" stroke-width="1"/>
  <text x="28" y="104" font-family="Verdana,DejaVu Sans,sans-serif" font-size="20" font-weight="bold" fill="#38bdf8">${esc(opts.message)}</text>
  <text x="28" y="132" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" fill="#64748b">Authenticated AI Build — verify at passport.metis.gold</text>
  <rect x="${W - 120}" y="116" width="104" height="28" rx="6" fill="${color}" fill-opacity="0.15"/>
  <text x="${W - 68}" y="135" font-family="Verdana,DejaVu Sans,sans-serif" font-size="12" font-weight="bold" fill="${color}" text-anchor="middle">Verify →</text>
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

function cors(): Record<string, string> {
  return { "Access-Control-Allow-Origin": "*" };
}