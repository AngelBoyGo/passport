import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in — Passport",
  description: "Sign in to your Passport operator dashboard.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
