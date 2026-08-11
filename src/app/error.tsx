"use client";

import Link from "next/link";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        fontFamily:
          'system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"',
        height: "100vh",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div>
        <h1
          style={{
            display: "inline-block",
            margin: "0 20px 0 0",
            padding: "0 23px 0 0",
            fontSize: 24,
            fontWeight: 500,
            verticalAlign: "top",
            lineHeight: "49px",
          }}
        >
          Something went wrong
        </h1>
        <div style={{ display: "inline-block" }}>
          <h2
            style={{
              fontSize: 14,
              fontWeight: 400,
              lineHeight: "49px",
              margin: 0,
            }}
          >
            An unexpected error occurred.
          </h2>
        </div>
      </div>
      <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
        <button
          onClick={reset}
          style={{
            padding: "8px 16px",
            background: "#4f46e5",
            color: "white",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          Try again
        </button>
        <Link
          href="/"
          style={{
            padding: "8px 16px",
            background: "#e5e7eb",
            color: "#111827",
            borderRadius: 6,
            textDecoration: "none",
            fontSize: 14,
          }}
        >
          Back home
        </Link>
      </div>
      {error.digest && (
        <p
          style={{
            marginTop: 24,
            fontSize: 12,
            color: "#9ca3af",
            fontFamily: "monospace",
          }}
        >
          Error ID: {error.digest}
        </p>
      )}
    </div>
  );
}