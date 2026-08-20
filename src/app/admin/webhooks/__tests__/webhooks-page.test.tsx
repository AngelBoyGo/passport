import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import AdminWebhooks from "@/app/admin/webhooks/page";

const mockSubs = [
  {
    id: "wh-1",
    url: "https://example.com/webhook",
    events: ["evidence.anchored"],
    active: true,
    createdAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "wh-2",
    url: "https://other.com/hook",
    events: ["evidence.anchored", "enrollment.completed"],
    active: true,
    createdAt: "2026-08-15T00:00:00.000Z",
  },
];

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, opts) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : "";
    const method = (opts?.method as string) ?? "GET";

    if (path.includes("/api/admin/webhooks") && method === "GET") {
      return new Response(JSON.stringify(mockSubs), { status: 200 });
    }
    if (path.includes("/api/admin/webhooks") && method === "POST") {
      return new Response(
        JSON.stringify({ id: "wh-3", url: "https://new.com/hook", events: ["evidence.anchored"], secret: "whsec_test_secret", active: true }),
        { status: 201 }
      );
    }
    if (typeof path === "string" && path.includes("/api/admin/webhooks/") && method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AdminWebhooks (Session-Authenticated)", () => {
  it("auto-loads and displays webhook subscriptions on mount", async () => {
    render(<AdminWebhooks />);

    await waitFor(() => {
      expect(screen.getByText(/example\.com/)).toBeInTheDocument();
    });
    expect(screen.getByText(/other\.com/)).toBeInTheDocument();
  });

  it("shows empty state when no subscriptions exist", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 })
    );
    render(<AdminWebhooks />);

    await waitFor(() => {
      expect(screen.getByText(/no webhooks configured/i)).toBeInTheDocument();
    });
  });

  it("calls POST when creating a subscription", async () => {
    render(<AdminWebhooks />);
    const urlInput = screen.getByPlaceholderText(/https:\/\/example/);
    fireEvent.change(urlInput, { target: { value: "https://new.com/hook" } });

    const createBtn = screen.getByRole("button", { name: /create subscription/i });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/admin/webhooks",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("new.com"),
        })
      );
    });
  });

  it("calls DELETE when deleting a subscription", async () => {
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);

    render(<AdminWebhooks />);

    await waitFor(() => {
      expect(screen.getByText(/example\.com/)).toBeInTheDocument();
    });

    const deleteBtns = screen.getAllByRole("button", { name: /delete/i });
    expect(deleteBtns.length).toBeGreaterThan(0);
    fireEvent.click(deleteBtns[0]);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/admin/webhooks/wh-1",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  it("shows error for API failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network failure"));
    render(<AdminWebhooks />);

    await waitFor(() => {
      expect(screen.getByText(/network failure/i)).toBeInTheDocument();
    });
  });
});
