import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Playground — Passport",
  description: "Try Passport's public verification APIs live — no API key required.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
