export type PassportDevPortStatus = "free" | "healthy" | "occupied-unhealthy";

export type PassportDevStackAction = "reuse" | "start" | "blocked";

export type PassportDevStackPlan = {
  action: PassportDevStackAction;
  exitCode: 0 | 1;
  message: string;
};

/**
 * Normalizes the local Passport base URL used by stack and smoke helpers.
 */
export function normalizeLocalBaseUrl(
  baseUrl = "http://localhost:3000"
): string {
  return baseUrl.trim().replace(/\/$/, "");
}

/**
 * Formats the operator guidance for a stale or unhealthy process on port 3000.
 */
export function formatPortBlockedMessage(baseUrl: string): string {
  return [
    `Port 3000 is occupied, but ${baseUrl}/api/health is not healthy.`,
    "Stop the process using port 3000, then run npm run dev:passport-stack again.",
    "On Windows, use Resource Monitor or netstat -ano | findstr :3000, then stop the matching process.",
    "Please do not start another Next dev server on port 3001 for Passport live verification.",
  ].join("\n");
}

/**
 * Creates the local dev-stack action from the observed port/health status.
 */
export function createPassportDevStackPlan(input: {
  portStatus: PassportDevPortStatus;
  baseUrl?: string;
}): PassportDevStackPlan {
  const baseUrl = normalizeLocalBaseUrl(input.baseUrl);

  if (input.portStatus === "healthy") {
    return {
      action: "reuse",
      exitCode: 0,
      message: `Passport dev server healthy on ${baseUrl}`,
    };
  }

  if (input.portStatus === "free") {
    return {
      action: "start",
      exitCode: 0,
      message: `Starting Passport dev server on port 3000 (${baseUrl})`,
    };
  }

  return {
    action: "blocked",
    exitCode: 1,
    message: formatPortBlockedMessage(baseUrl),
  };
}
