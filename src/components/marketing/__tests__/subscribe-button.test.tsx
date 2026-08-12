import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SubscribeButton } from "@/components/marketing/subscribe-button";

describe("SubscribeButton", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("explains that sign-in is required when logged out", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ authenticated: false }), { status: 401 })
    );

    render(<SubscribeButton />);
    fireEvent.click(screen.getByRole("button", { name: /subscribe/i }));

    expect(await screen.findByRole("link", { name: /sign in to subscribe/i })).toBeInTheDocument();
  });
});
