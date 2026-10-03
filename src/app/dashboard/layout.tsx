import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard — Passport",
  description: "Your Passport operator dashboard: identity, agents, and AngelCoin economy.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
