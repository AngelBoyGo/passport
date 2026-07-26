import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * Returns true when the provided bearer token matches PASSPORT_SERVICE_TOKEN.
 */
export function verifyPassportServiceToken(
  authorizationHeader: string | null,
  expectedToken: string
): boolean {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return false;
  }
  const provided = authorizationHeader.slice(7);
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expectedToken);
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Validates service token for task_deliverable evidence ingestion when configured.
 */
export function requireTaskDeliverableServiceAuth(
  request: NextRequest,
  sourceType: string
): NextResponse | null {
  if (sourceType !== "task_deliverable") {
    return null;
  }

  const authRequired = process.env.EVIDENCE_SERVICE_AUTH_REQUIRED === "true";
  if (!authRequired) {
    return null;
  }

  const expected = process.env.PASSPORT_SERVICE_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "Evidence service auth is misconfigured" },
      { status: 500 }
    );
  }

  if (!verifyPassportServiceToken(request.headers.get("authorization"), expected)) {
    return NextResponse.json({ error: "Unauthorized service token" }, { status: 401 });
  }

  return null;
}
