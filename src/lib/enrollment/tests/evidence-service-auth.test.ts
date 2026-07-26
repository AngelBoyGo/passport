import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  requireTaskDeliverableServiceAuth,
  verifyPassportServiceToken,
} from "@/lib/enrollment/service-auth";

describe("evidence service auth", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("PASSPORT_SERVICE_TOKEN", "passport-shared-secret-token");
    vi.stubEnv("EVIDENCE_SERVICE_AUTH_REQUIRED", "true");
  });

  it("verifyPassportServiceToken rejects missing bearer prefix", () => {
    expect(
      verifyPassportServiceToken("passport-shared-secret-token", "passport-shared-secret-token")
    ).toBe(false);
  });

  it("verifyPassportServiceToken accepts matching bearer token", () => {
    expect(
      verifyPassportServiceToken(
        "Bearer passport-shared-secret-token",
        "passport-shared-secret-token"
      )
    ).toBe(true);
  });

  it("requireTaskDeliverableServiceAuth returns 401 when token header is missing", () => {
    const request = new NextRequest("http://localhost/api/v1/passport/agents/x/evidence", {
      method: "POST",
    });

    const response = requireTaskDeliverableServiceAuth(request, "task_deliverable");
    expect(response?.status).toBe(401);
  });

  it("requireTaskDeliverableServiceAuth returns 401 for wrong token", () => {
    const request = new NextRequest("http://localhost/api/v1/passport/agents/x/evidence", {
      method: "POST",
      headers: { authorization: "Bearer wrong-token-value" },
    });

    const response = requireTaskDeliverableServiceAuth(request, "task_deliverable");
    expect(response?.status).toBe(401);
  });

  it("requireTaskDeliverableServiceAuth allows valid token for task_deliverable", () => {
    const request = new NextRequest("http://localhost/api/v1/passport/agents/x/evidence", {
      method: "POST",
      headers: { authorization: "Bearer passport-shared-secret-token" },
    });

    expect(requireTaskDeliverableServiceAuth(request, "task_deliverable")).toBeNull();
  });

  it("requireTaskDeliverableServiceAuth skips non-task_deliverable source types", () => {
    const request = new NextRequest("http://localhost/api/v1/passport/agents/x/evidence", {
      method: "POST",
    });

    expect(requireTaskDeliverableServiceAuth(request, "photo_clearance")).toBeNull();
  });
});
