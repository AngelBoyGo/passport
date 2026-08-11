import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const { hash } = await params;

  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    return badgeResponse("Passport", "invalid", "#9ca3af", 300);
  }

  const [enrollment, evidenceCount] = await Promise.all([
    prisma.agentEnrollment.findUnique({
      where: { subjectCommitment: hash },
      select: { status: true },
    }),
    prisma.agentEvidence.count({
      where: { agentIdentityCommitment: hash },
    }),
  ]);

  if (!enrollment) {
    return badgeResponse("Passport", "not found", "#9ca3af", 300);
  }

  if (enrollment.status === "ISSUED" && evidenceCount > 0) {
    return badgeResponse(
      "passport",
      `${evidenceCount} receipt${evidenceCount !== 1 ? "s" : ""}`,
      "#22c55e",
      3600
    );
  }

  if (enrollment.status === "ISSUED") {
    return badgeResponse("passport", "enrolled", "#3b82f6", 3600);
  }

  return badgeResponse("Passport", enrollment.status.toLowerCase(), "#f59e0b", 300);
}

function badgeResponse(
  label: string,
  message: string,
  color: string,
  maxAge: number
): NextResponse {
  const labelWidth = label.length * 7 + 14;
  const msgWidth = message.length * 7 + 14;
  const totalWidth = labelWidth + msgWidth;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${message}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${msgWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#fff" fill-opacity=".9">${label}</text>
    <text x="${labelWidth + msgWidth / 2}" y="15" fill="#fff" fill-opacity=".9">${message}</text>
  </g>
</svg>`;

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": `public, max-age=${maxAge}`,
    },
  });
}