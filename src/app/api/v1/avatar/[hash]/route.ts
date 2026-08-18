import { NextRequest, NextResponse } from "next/server";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export const dynamic = "force-dynamic";

/**
 * Deterministic SVG identicon from a subject commitment hash.
 * Generates a unique, visually distinct avatar for each agent.
 * 5x5 grid of colored cells derived from the hash.
 */
function generateIdenticon(hash: string): string {
  const cells = 5;
  const cellSize = 40;
  const padding = 10;
  const size = cells * cellSize + padding * 2;
  const half = Math.ceil(cells / 2);

  // Derive a hue from the first 6 hex chars of the hash
  const hue = (parseInt(hash.slice(0, 6), 16) % 360);
  const sat = 55 + (parseInt(hash.slice(6, 8), 16) % 30); // 55-85%
  const light = 45 + (parseInt(hash.slice(8, 10), 16) % 20); // 45-65%

  const bgColor = `hsl(${hue}, ${sat}%, ${light}%)`;
  const fgLight = Math.min(light + 30, 90);
  const fgColor = `hsl(${hue}, ${sat - 10}%, ${fgLight}%)`;

  let cellsStr = "";
  let idx = 10;

  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < half; x++) {
      const byteVal = parseInt(hash.slice(idx, idx + 2), 16) || 0;
      idx = (idx + 2) % (hash.length - 2);
      const filled = byteVal > 127;
      const mirrorX = cells - 1 - x;

      if (filled) {
        const cx = x * cellSize + padding;
        const cy = y * cellSize + padding;
        cellsStr += `<rect x="${cx}" y="${cy}" width="${cellSize}" height="${cellSize}" rx="4" fill="${fgColor}" />`;
        if (mirrorX !== x) {
          const mx = mirrorX * cellSize + padding;
          cellsStr += `<rect x="${mx}" y="${cy}" width="${cellSize}" height="${cellSize}" rx="4" fill="${fgColor}" />`;
        }
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${padding}" fill="${bgColor}" />
  ${cellsStr}
</svg>`;
}

/**
 * GET /api/v1/avatar/:hash — deterministic SVG identicon for an agent.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const { hash } = await params;

  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    return new NextResponse("Invalid hash", { status: 400 });
  }

  const svg = generateIdenticon(hash.toLowerCase());

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}