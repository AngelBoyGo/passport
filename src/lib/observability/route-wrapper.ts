import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { logPassportEvent, type PassportLogOutcome } from "./logger";

type RouteHandler<Context = unknown> = (
  request: NextRequest,
  context: Context
) => Promise<Response | NextResponse>;

export type RouteObservabilityEvent =
  | "gate_verify"
  | "receipt_issue"
  | "credits_read";

function outcomeFromStatus(status: number): PassportLogOutcome {
  if (status >= 500) return "error";
  if (status >= 400) return "rejected";
  return "issued";
}

/**
 * Wraps a Next.js route handler with request_id generation and one completion log line.
 */
export function withRouteObservability<Context>(
  handler: RouteHandler<Context>,
  event: RouteObservabilityEvent
): RouteHandler<Context> {
  return async (request: NextRequest, context: Context) => {
    const start = Date.now();
    const request_id = randomUUID();

    try {
      const response = await handler(request, context);
      const http_status = response.status;
      const latency_ms = Date.now() - start;

      logPassportEvent({
        event,
        outcome: outcomeFromStatus(http_status),
        http_status,
        request_id,
        latency_ms,
      });

      return response;
    } catch {
      const latency_ms = Date.now() - start;

      logPassportEvent({
        event: "unhandled_error",
        outcome: "error",
        http_status: 500,
        request_id,
        latency_ms,
      });

      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}
