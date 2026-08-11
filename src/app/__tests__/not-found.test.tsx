import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NotFoundPage from "@/app/not-found";

describe("NotFoundPage", () => {
  it("renders 404 heading", () => {
    render(<NotFoundPage />);
    expect(screen.getByText("404")).toBeInTheDocument();
  });

  it("renders descriptive message", () => {
    render(<NotFoundPage />);
    expect(screen.getByText(/This page could not be found/i)).toBeInTheDocument();
  });

  it("renders a link back to home", () => {
    render(<NotFoundPage />);
    const link = screen.getByRole("link", { name: /home/i });
    expect(link).toHaveAttribute("href", "/");
  });
});