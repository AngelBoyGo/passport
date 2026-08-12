import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LiveVerifyDemo } from "@/components/marketing/live-verify-demo";

describe("LiveVerifyDemo", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows a visible verification result after the demo is started", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ algorithm: "ed25519", public_key: "a".repeat(64) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    render(<LiveVerifyDemo />);
    fireEvent.click(screen.getByRole("button", { name: /live verify demo/i }));

    expect(await screen.findByTestId("demo-verification-result")).toHaveTextContent(
      "Verifier online"
    );
    expect(screen.getByText(/public key loaded/i)).toBeInTheDocument();
  });
});
