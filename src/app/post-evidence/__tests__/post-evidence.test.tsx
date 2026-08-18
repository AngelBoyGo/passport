import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import PostEvidencePage from "@/app/post-evidence/page";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(globalThis, "crypto", {
    value: {
      subtle: {
        digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
      },
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fillAllFields() {
  // Both inputs have the same placeholder — use first for commitment, last for private key
  const inputs = screen.getAllByPlaceholderText(/64-char hex/i);
  fireEvent.change(inputs[0], { target: { value: "a".repeat(64) } });
  fireEvent.change(inputs[inputs.length - 1], { target: { value: "b".repeat(64) } });
}

describe("PostEvidencePage", () => {
  it("renders all form elements", () => {
    render(<PostEvidencePage />);
    expect(screen.getAllByPlaceholderText(/64-char hex/i).length).toBe(2);
    expect(screen.getByText(/GitHub Commit/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/\{ "sha":/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign & post/i })).toBeInTheDocument();
  });

  it("loads sample payload when button clicked", () => {
    render(<PostEvidencePage />);
    fireEvent.click(screen.getByRole("button", { name: /load sample/i }));
    const textarea = screen.getByPlaceholderText(/\{ "sha":/) as HTMLTextAreaElement;
    expect(textarea.value).toContain("abc123def456");
  });

  it("shows invalid JSON error for malformed payload", async () => {
    render(<PostEvidencePage />);
    const textarea = screen.getByPlaceholderText(/\{ "sha":/);
    fireEvent.change(textarea, { target: { value: "not json" } });
    await waitFor(() => {
      expect(screen.getByText(/Invalid JSON/i)).toBeInTheDocument();
    }, { timeout: 1500 });
  });

  it("shows canonical JSON preview for valid payload", async () => {
    render(<PostEvidencePage />);
    const textarea = screen.getByPlaceholderText(/\{ "sha":/);
    fireEvent.change(textarea, { target: { value: JSON.stringify({ a: 1, b: 2 }) } });
    await waitFor(() => {
      expect(screen.getByText(/Canonical JSON/i)).toBeInTheDocument();
    }, { timeout: 1500 });
  });
});