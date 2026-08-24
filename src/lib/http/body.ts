import { NextRequest } from "next/server";

/**
 * Hard JSON body-size cap for API routes (Denial-of-Service defense).
 * Reads the body stream with a byte cap and rejects over-limit payloads without
 * buffering unbounded data; content-length is pre-checked for a fast reject and
 * to bound the no-reader fallback path.
 */
export const MAX_JSON_BODY = 1_048_576; // 1 MB

export async function readJsonBody(
  request: NextRequest
): Promise<{ ok: true; data: unknown } | { ok: false; status: 400 | 413 }> {
  // Fast path: content-length is present and over the cap → reject without reading.
  const rawLength = request.headers.get("content-length");
  const contentLength = rawLength ? Number(rawLength) : Number.NaN;
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY) {
    return { ok: false, status: 413 };
  }

  let text: string;
  try {
    const stream = request.body;
    if (!stream) {
      // F6: avoid unbounded request.text(). Read a single ArrayBuffer and
      // enforce the cap on its byte length. Web APIs throw RangeError if the
      // buffer exceeds impl limits; anything over our cap rejects as 413.
      const buf = await request.arrayBuffer();
      if (buf.byteLength > MAX_JSON_BODY) {
        return { ok: false, status: 413 };
      }
      text = new TextDecoder().decode(new Uint8Array(buf));
    } else {
      const reader = stream.getReader();
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

  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400 };
  }
}