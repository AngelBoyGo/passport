import { describe, it, expect, vi, beforeEach } from "vitest";
import { EnrollmentStatus } from "@prisma/client";

const updatePresentationMock = vi.fn();
const logPassportEventMock = vi.fn();

vi.mock("@/lib/enrollment/presentation-service", () => ({
  updatePresentation: (...args: unknown[]) => updatePresentationMock(...args),
}));

vi.mock("@/lib/observability/logger", () => ({
  logPassportEvent: (...args: unknown[]) => logPassportEventMock(...args),
  enrollmentReasonCode: (status: number) =>
    status === 401 ? "invalid_proof" : status === 403 ? "not_enrolled" : "validation_error",
}));

const VALID_COMMITMENT = "b".repeat(64);
const VALID_SIG = "c".repeat(128);

beforeEach(async () => {
  vi.resetModules();
  updatePresentationMock.mockReset();
  logPassportEventMock.mockReset();
  const { resetInMemoryRateLimits } = await import("@/lib/rateLimit");
  resetInMemoryRateLimits();
});

describe("PUT /api/v1/passport/agents/[id]/presentation", () => {
  it("returns 200 on successful update", async () => {
    updatePresentationMock.mockResolvedValue({
      presentation: {
        url: "https://cdn.example.com/agent.png",
        content_sha256: "d".repeat(64),
        mime_type: "image/png",
        updated_at: "2026-06-28T12:00:00.000Z",
      },
    });

    const { PUT } = await import(
      "@/app/api/v1/passport/agents/[id]/presentation/route"
    );

    const response = await PUT(
      new Request(
        `http://localhost/api/v1/passport/agents/${VALID_COMMITMENT}/presentation`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            photo_url: "https://cdn.example.com/agent.png",
            photo_content_sha256: "d".repeat(64),
            photo_mime_type: "image/png",
            signature: VALID_SIG,
          }),
        }
      ) as import("next/server").NextRequest,
      { params: Promise.resolve({ id: VALID_COMMITMENT }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.presentation.url).toBe("https://cdn.example.com/agent.png");
    expect(logPassportEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "presentation_update",
        outcome: "issued",
        subject_commitment: VALID_COMMITMENT,
        photo_content_sha256: "d".repeat(64),
      })
    );
  });

  it("returns 401 on invalid proof", async () => {
    const { InvalidEnrollmentProofError } = await import("@/lib/enrollment/errors");
    updatePresentationMock.mockRejectedValue(new InvalidEnrollmentProofError());

    const { PUT } = await import(
      "@/app/api/v1/passport/agents/[id]/presentation/route"
    );

    const response = await PUT(
      new Request(
        `http://localhost/api/v1/passport/agents/${VALID_COMMITMENT}/presentation`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            photo_url: "https://cdn.example.com/agent.png",
            photo_content_sha256: "d".repeat(64),
            photo_mime_type: "image/png",
            signature: VALID_SIG,
          }),
        }
      ) as import("next/server").NextRequest,
      { params: Promise.resolve({ id: VALID_COMMITMENT }) }
    );

    expect(response.status).toBe(401);
    expect(logPassportEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "presentation_update",
        outcome: "rejected",
        reason_code: "invalid_proof",
      })
    );
  });

  it("returns 403 when not enrolled", async () => {
    const { NotEnrolledError } = await import("@/lib/enrollment/errors");
    updatePresentationMock.mockRejectedValue(new NotEnrolledError());

    const { PUT } = await import(
      "@/app/api/v1/passport/agents/[id]/presentation/route"
    );

    const response = await PUT(
      new Request(
        `http://localhost/api/v1/passport/agents/${VALID_COMMITMENT}/presentation`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            photo_url: "https://cdn.example.com/agent.png",
            photo_content_sha256: "d".repeat(64),
            photo_mime_type: "image/png",
            signature: VALID_SIG,
          }),
        }
      ) as import("next/server").NextRequest,
      { params: Promise.resolve({ id: VALID_COMMITMENT }) }
    );

    expect(response.status).toBe(403);
  });

  it("returns 400 for bad URL scheme", async () => {
    const { InvalidEnrollmentInputError } = await import("@/lib/enrollment/errors");
    updatePresentationMock.mockRejectedValue(
      new InvalidEnrollmentInputError("photo_url must use https")
    );

    const { PUT } = await import(
      "@/app/api/v1/passport/agents/[id]/presentation/route"
    );

    const response = await PUT(
      new Request(
        `http://localhost/api/v1/passport/agents/${VALID_COMMITMENT}/presentation`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            photo_url: "http://cdn.example.com/agent.png",
            photo_content_sha256: "d".repeat(64),
            photo_mime_type: "image/png",
            signature: VALID_SIG,
          }),
        }
      ) as import("next/server").NextRequest,
      { params: Promise.resolve({ id: VALID_COMMITMENT }) }
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 for missing content hash when url set", async () => {
    const { PUT } = await import(
      "@/app/api/v1/passport/agents/[id]/presentation/route"
    );

    const response = await PUT(
      new Request(
        `http://localhost/api/v1/passport/agents/${VALID_COMMITMENT}/presentation`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            photo_url: "https://cdn.example.com/agent.png",
            photo_content_sha256: "bad",
            photo_mime_type: "image/png",
            signature: VALID_SIG,
          }),
        }
      ) as import("next/server").NextRequest,
      { params: Promise.resolve({ id: VALID_COMMITMENT }) }
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 for invalid agent id", async () => {
    const { PUT } = await import(
      "@/app/api/v1/passport/agents/[id]/presentation/route"
    );

    const response = await PUT(
      new Request(
        "http://localhost/api/v1/passport/agents/bad/presentation",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            photo_url: "https://cdn.example.com/agent.png",
            photo_content_sha256: "d".repeat(64),
            photo_mime_type: "image/png",
            signature: VALID_SIG,
          }),
        }
      ) as import("next/server").NextRequest,
      { params: Promise.resolve({ id: "bad" }) }
    );

    expect(response.status).toBe(400);
  });
});
