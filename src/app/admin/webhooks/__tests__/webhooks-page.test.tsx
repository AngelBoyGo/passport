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
  localStorage.clear();
  localStorage.setItem("passport_admin_key", "pp_test_key");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, opts) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : "";
    const method = (opts?.method as string) ?? "GET";

    if (path === "/api/v1/webhooks" && method === "GET") {
      return new Response(JSON.stringify(mockSubs), { status: 200 });
    }
    if (path === "/api/v1/webhooks" && method === "POST") {
      return new Response(
        JSON.stringify({ id: "wh-3", url: "https://new.com/hook", events: ["evidence.anchored"], secret: "whsec_test_secret", active: true }),
        { status: 201 }
      );
    }
    if (typeof path === "string" && path.startsWith("/api/v1/webhooks/") && method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AdminWebhooks", () => {
  it("loads and displays webhook subscriptions", async () => {
    render(<AdminWebhooks />);
    const loadBtn = screen.getByRole("button", { name: /load/i });
    fireEvent.click(loadBtn);

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
    const loadBtn = screen.getByRole("button", { name: /load/i });
    fireEvent.click(loadBtn);

    await waitFor(() => {
      expect(screen.getByText(/no webhooks configured/i)).toBeInTheDocument();
    });
  });

  it("calls POST when creating a subscription", async () => {
    render(<AdminWebhooks />);
    const urlInput = screen.getByPlaceholderText(/https:\/\/example/);
    fireEvent.change(urlInput, { target: { value: "https://new.com/hook" } });

    const createBtn = screen.getByRole("button", { name: /^Create$/ });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/v1/webhooks",
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
    const loadBtn = screen.getByRole("button", { name: /load/i });
    fireEvent.click(loadBtn);

    await waitFor(() => {
      expect(screen.getByText(/example\.com/)).toBeInTheDocument();
    });

    const deleteBtns = screen.getAllByRole("button", { name: /delete/i });
    expect(deleteBtns.length).toBeGreaterThan(0);
    fireEvent.click(deleteBtns[0]);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/v1/webhooks/wh-1",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  it("shows error for API failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network failure"));
    render(<AdminWebhooks />);
    const loadBtn = screen.getByRole("button", { name: /load/i });
    fireEvent.click(loadBtn);

    await waitFor(() => {
      expect(screen.getByText(/network failure/i)).toBeInTheDocument();
    });
  });
});