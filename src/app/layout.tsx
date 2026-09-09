import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://passport.metis.gold"),
  title: {
    default: "Passport — Free, open-source identity & authenticity for AI agents",
    template: "%s · Passport",
  },
  description:
    "Free, open-source (MIT) tamper-evident identity & authenticity layer for AI agents. " +
    "Issue Ed25519-signed receipts, post signed behavioral evidence, verify agents, and use " +
    "the commodity-backed Sovereign Haven RWA stack (ANGEL, Proof-of-Reserves, escrow, transit, " +
    "AMM, rail factory). No payment required for the core protocol, any SDK, or verification.",
  keywords: [
    "AI agents",
    "identity",
    "verification",
    "receipts",
    "Ed25519",
    "open source",
    "AngelCoin",
    "ANGEL",
    "Sovereign Haven",
    "Proof-of-Reserves",
    "Passport",
  ],
  openGraph: {
    title: "Passport — Free, open-source identity & authenticity for AI agents",
    description:
      "Issue and verify Ed25519-signed behavioral receipts for AI agents. Free tier, keyless verification, MIT-licensed SDK.",
    url: "https://passport.metis.gold",
    siteName: "Passport",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Passport — Free, open-source identity & authenticity for AI agents",
    description:
      "Issue and verify Ed25519-signed behavioral receipts for AI agents. Free tier, keyless verification, MIT SDK.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
