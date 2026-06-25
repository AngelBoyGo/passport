export class PassportHttpError extends Error {
  readonly status?: number;
  readonly responseBody?: unknown;

  constructor(message: string, status?: number, responseBody?: unknown) {
    super(message);
    this.name = "PassportHttpError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export interface FetchWithRetryOptions {
  timeoutMs?: number;
  maxAttempts?: number;
}

const DEFAULT_BACKOFF_MS = [200, 400, 800] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Fetch with timeout, exponential backoff on 5xx/network errors, no retry on 4xx.
 */
export async function fetchWithRetry(
  url: string | URL,
  init?: RequestInit,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 4000;
  const maxAttempts = options.maxAttempts ?? 3;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await globalThis.fetch(url, {
        ...init,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status >= 400 && response.status < 500) {
        return response;
      }

      if (response.status >= 500) {
        if (attempt < maxAttempts - 1) {
          await sleep(DEFAULT_BACKOFF_MS[attempt] ?? 800);
          continue;
        }
        throw new PassportHttpError(
          `HTTP ${response.status}`,
          response.status,
          await safeJson(response)
        );
      }

      return response;
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof PassportHttpError) {
        throw err;
      }

      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < maxAttempts - 1) {
        await sleep(DEFAULT_BACKOFF_MS[attempt] ?? 800);
        continue;
      }
    }
  }

  throw new PassportHttpError(
    lastError?.message ?? "Request failed after retries",
    undefined,
    undefined
  );
}
