import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import AdminPassportsPage from "@/app/admin/passports/page";

const mockData = {
  counts: {
    total: 2,
    issued: 1,
    pending: 1,
    revoked: 0,
  },
  passports: [
    {
      id: "enr_1",
      subjectCommitment: "a".repeat(64),
      publicKey: "pub_1",
      context: "Alpha Trading Agent",
      status: "ISSUED",
      issuedAt: "2026-09-01T00:00:00.000Z",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      photoUrl: null,
      evidenceCount: 42,
    },
    {
      id: "enr_2",
      subjectCommitment: "b".repeat(64),
      publicKey: "pub_2",
      context: "Code Generation Agent",
      status: "PENDING",
      issuedAt: null,
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:00:00.000Z",
      photoUrl: null,
      evidenceCount: 5,
    },
  ],
};

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : "";
    if (path.includes("/api/admin/passports")) {
      return new Response(JSON.stringify(mockData), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AdminPassportsPage", () => {
  it("renders passports list and metrics cards", async () => {
    render(<AdminPassportsPage />);

    await waitFor(() => {
      expect(screen.getByText("Alpha Trading Agent")).toBeInTheDocument();
    });

    expect(screen.getByText("Code Generation Agent")).toBeInTheDocument();
    expect(screen.getByText("ISSUED")).toBeInTheDocument();
    expect(screen.getByText("PENDING")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("handles empty state when no passports found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ counts: { total: 0, issued: 0, pending: 0, revoked: 0 }, passports: [] }), { status: 200 })
    );

    render(<AdminPassportsPage />);

    await waitFor(() => {
      expect(screen.getByText(/no agent passports found/i)).toBeInTheDocument();
    });
  });
});
