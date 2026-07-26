import { NextResponse } from "next/server";
import {
  DuplicateEngagementError,
  EngagementNotFoundError,
  EngagementStateError,
  EvidenceMismatchError,
  EvidenceRequiredError,
} from "@/lib/engagement/errors";
import { angelcoinErrorResponse } from "@/lib/angelcoin/route-errors";
import { enrollmentErrorResponse } from "@/lib/enrollment/route-errors";

/**
 * Maps engagement service errors to HTTP responses.
 */
export function engagementErrorResponse(err: unknown): NextResponse | null {
  const enrollment = enrollmentErrorResponse(err);
  if (enrollment) return enrollment;

  const angelcoin = angelcoinErrorResponse(err);
  if (angelcoin) return angelcoin;

  if (err instanceof DuplicateEngagementError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof EngagementNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof EvidenceRequiredError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof EvidenceMismatchError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof EngagementStateError) {
    return NextResponse.json(
      { error: err.message, status: err.currentStatus },
      { status: 409 }
    );
  }
  return null;
}
