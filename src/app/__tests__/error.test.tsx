import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ErrorPage from "@/app/error";

describe("ErrorPage", () => {
  it("renders error heading", () => {
    render(<ErrorPage error={new Error("test error")} reset={vi.fn()} />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("renders descriptive message", () => {
    render(<ErrorPage error={new Error()} reset={vi.fn()} />);
    expect(
      screen.getByText(/An unexpected error occurred/i)
    ).toBeInTheDocument();
  });

  it("renders a retry button that calls reset", () => {
    const reset = vi.fn();
    render(<ErrorPage error={new Error()} reset={reset} />);
    const button = screen.getByRole("button", { name: /try again/i });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("renders a link back to home", () => {
    render(<ErrorPage error={new Error()} reset={vi.fn()} />);
    const link = screen.getByRole("link", { name: /home/i });
    expect(link).toHaveAttribute("href", "/");
  });
});