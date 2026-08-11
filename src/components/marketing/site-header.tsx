"use client";
import Link from "next/link";
import { useState } from "react";

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);

  const links = [
    { href: "/docs/getting-started", label: "Docs" },
    { href: "/docs/api-reference", label: "API" },
    { href: "/leaderboard", label: "Leaderboard" },
    { href: "/#pricing", label: "Pricing" },
  ];

  return (
    <header className="sticky top-0 z-50 border-b bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl font-bold tracking-tight">Passport</span>
          <span className="hidden rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 sm:inline">
            Beta
          </span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-slate-900">
              {l.label}
            </Link>
          ))}
          <Link
            href="/api/v1/public-key"
            className="rounded-lg border px-3 py-1.5 text-xs font-mono hover:bg-slate-50"
          >
            Public Key
          </Link>
          <Link
            href="/admin"
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-white hover:bg-indigo-700"
          >
            Dashboard
          </Link>
        </nav>

        <button
          className="md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Menu"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {mobileOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t px-6 py-4 md:hidden">
          <nav className="flex flex-col gap-3 text-sm">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="text-slate-600 hover:text-slate-900" onClick={() => setMobileOpen(false)}>
                {l.label}
              </Link>
            ))}
            <Link href="/admin" className="text-indigo-600 font-medium" onClick={() => setMobileOpen(false)}>
              Dashboard →
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}