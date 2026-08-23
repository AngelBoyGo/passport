import { NextRequest } from "next/server";

/**
 * Hard JSON body-size cap for API routes (Denial-of-Service defense).
 * content-length is not reliable with chunked transfer, so this helper reads
 * the body stream with a byte cap and rejects over-limit payloads without
 * buffering unbounded data.
 */
export const MAX_JSON_BODY = 1_048_576; // 1 MB

export async function readJsonBody(
  request: NextRequest
): Promise<{ ok: true; data: unknown } | { ok: false; status: 400 | 413 }> {
  let text: string;
  try {
    const reader = request.body?.getReader();
    if (!reader) {
      const raw = await request.text();
      text = raw;
    } else {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > MAX_JSON_BODY) {
            return { ok: false, status: 413 };
          }
          chunks.push(value);
        }
      }
      text = new TextDecoder().decode(new Uint8Array(Buffer.concat(chunks)));
    }
  } catch {
    return { ok: false, status: 413 };
  }

  if (text.length > MAX_JSON_BODY * 2) {
    return { ok: false, status: 413 };
  }

  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400 };
  }
}