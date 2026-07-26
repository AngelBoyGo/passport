/**
 * Load baseline args, timing helpers, and fetch-based probe runner.
 */
import { ENROLLMENT_READINESS_PROBE_COMMITMENT } from "./contract-check";

export type LoadBaselineEndpoint = {
  name: string;
  path: string;
  method: "GET" | "POST";
  body?: string;
};

export type LoadBaselineArgs =
  | {
      ok: true;
      baseUrl: string;
      dryRun: boolean;
      requestsPerEndpoint: number;
      endpoints: LoadBaselineEndpoint[];
    }
  | { ok: false; error: string };

export type EndpointLatencySummary = {
  name: string;
  path: string;
  method: "GET" | "POST";
  samples: number;
  errors: number;
  p50Ms: number;
  p95Ms: number;
};

export type LoadBaselineSummary = {
  baseUrl: string;
  requestsPerEndpoint: number;
  endpoints: EndpointLatencySummary[];
};

const DEFAULT_REQUESTS_PER_ENDPOINT = 10;

/** Default read-only endpoints for a single-replica baseline snapshot. */
export const DEFAULT_LOAD_BASELINE_ENDPOINTS: LoadBaselineEndpoint[] = [
  { name: "health", path: "/api/health", method: "GET" },
  { name: "public_key", path: "/api/v1/public-key", method: "GET" },
  {
    name: "gate_verify",
    path: "/api/v1/gate/verify",
    method: "POST",
    body: JSON.stringify({ gate_pass: "baseline-probe" }),
  },
  {
    name: "profiles_get",
    path: `/api/v1/profiles/${ENROLLMENT_READINESS_PROBE_COMMITMENT}`,
    method: "GET",
  },
  {
    name: "passport_evidence",
    path: `/api/v1/passport/agents/${ENROLLMENT_READINESS_PROBE_COMMITMENT}/passport`,
    method: "GET",
  },
];

/**
 * Returns true when the string is a valid http(s) URL.
 */
export function isValidBaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Parses CLI args for the load baseline script.
 */
export function parseLoadBaselineArgs(argv: string[]): LoadBaselineArgs {
  const values = new Map<string, string>();
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (!arg.startsWith("--")) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      return { ok: false, error: `Missing value for ${arg}` };
    }
    values.set(arg, next);
    i += 1;
  }

  const baseUrl = values.get("--base-url")?.replace(/\/+$/, "");
  if (!baseUrl) {
    return { ok: false, error: "--base-url is required" };
  }

  if (!isValidBaseUrl(baseUrl)) {
    return { ok: false, error: "Invalid --base-url: must be a valid http(s) URL" };
  }

  const requestsRaw = values.get("--requests");
  const requestsPerEndpoint = requestsRaw
    ? Number.parseInt(requestsRaw, 10)
    : DEFAULT_REQUESTS_PER_ENDPOINT;

  if (
    !Number.isFinite(requestsPerEndpoint) ||
    requestsPerEndpoint < 1 ||
    requestsPerEndpoint > 1000
  ) {
    return {
      ok: false,
      error: "--requests must be an integer between 1 and 1000",
    };
  }

  return {
    ok: true,
    baseUrl,
    dryRun,
    requestsPerEndpoint,
    endpoints: DEFAULT_LOAD_BASELINE_ENDPOINTS,
  };
}

/**
 * Computes a percentile from sorted latency samples (simple rank index).
 */
export function percentile(sortedSamples: number[], p: number): number {
  if (sortedSamples.length === 0) {
    return 0;
  }

  const rank = Math.ceil((p / 100) * sortedSamples.length) - 1;
  const index = Math.min(Math.max(rank, 0), sortedSamples.length - 1);
  return sortedSamples[index] ?? 0;
}

/**
 * Summarizes latency samples into p50/p95 milliseconds.
 */
export function summarizeLatencies(
  samplesMs: number[]
): Pick<EndpointLatencySummary, "samples" | "p50Ms" | "p95Ms"> {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
  };
}

/**
 * Runs a fetch-based timing loop against one endpoint.
 */
export async function probeEndpoint(
  baseUrl: string,
  endpoint: LoadBaselineEndpoint,
  requests: number,
  fetchImpl: typeof fetch = fetch
): Promise<EndpointLatencySummary> {
  const url = `${baseUrl}${endpoint.path}`;
  const samplesMs: number[] = [];
  let errors = 0;

  for (let i = 0; i < requests; i += 1) {
    const started = performance.now();
    try {
      const response = await fetchImpl(url, {
        method: endpoint.method,
        headers:
          endpoint.method === "POST"
            ? { "content-type": "application/json" }
            : undefined,
        body: endpoint.body,
      });
      await response.arrayBuffer();
    } catch {
      errors += 1;
    } finally {
      samplesMs.push(Math.round(performance.now() - started));
    }
  }

  const summary = summarizeLatencies(samplesMs);
  return {
    name: endpoint.name,
    path: endpoint.path,
    method: endpoint.method,
    errors,
    ...summary,
  };
}

/**
 * Runs baseline probes for all default endpoints and returns JSON-ready summary.
 */
export async function runLoadBaseline(
  args: Extract<LoadBaselineArgs, { ok: true }>,
  fetchImpl: typeof fetch = fetch
): Promise<LoadBaselineSummary> {
  const endpoints: EndpointLatencySummary[] = [];

  for (const endpoint of args.endpoints) {
    endpoints.push(
      await probeEndpoint(
        args.baseUrl,
        endpoint,
        args.requestsPerEndpoint,
        fetchImpl
      )
    );
  }

  return {
    baseUrl: args.baseUrl,
    requestsPerEndpoint: args.requestsPerEndpoint,
    endpoints,
  };
}
