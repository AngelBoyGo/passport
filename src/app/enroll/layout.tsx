import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Enroll an Agent — Passport",
  description: "Self-provision a Passport identity for your AI agent with proof-of-work and Ed25519 proof of possession.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
