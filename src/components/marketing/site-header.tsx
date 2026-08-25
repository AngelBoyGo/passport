"use client";
import Link from "next/link";
import { useState, useEffect } from "react";

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile menu on route change (Next.js App Router)
  useEffect(() => {
    setMobileOpen(false);
  }, []);

  const links = [
    { href: "/datacenter", label: "Data Center" },
    { href: "/docs/getting-started", label: "Docs" },
    { href: "/docs/api-reference", label: "API" },
    { href: "/leaderboard", label: "Leaderboard" },
    { href: "/#pricing", label: "Pricing" },
    { href: "/public-key", label: "Public Key" },
  ];

  return (
    <header className="sticky top-0 z-50 border-b bg-white shadow-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Logo always visible */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="text-lg font-bold tracking-tight sm:text-xl">Passport</span>
          <span className="hidden rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 sm:inline">
            Beta
          </span>
        </Link>

        {/* Desktop nav — hidden on mobile */}
        <nav className="hidden items-center gap-4 text-sm font-medium text-slate-600 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-slate-900 transition-colors">
              {l.label}
            </Link>
          ))}
          <Link
            href="/dashboard"
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-white hover:bg-indigo-700 transition-colors"
          >
            Dashboard
          </Link>
        </nav>

        {/* Mobile hamburger — larger touch target */}
        <button
          className="flex md:hidden items-center justify-center p-2 -mr-2 rounded-lg hover:bg-slate-100 transition-colors"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {mobileOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile dropdown — full-width, animated */}
      <div
        className={`overflow-hidden transition-all duration-200 ease-in-out md:hidden ${
          mobileOpen ? "max-h-80 opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        {mobileOpen && (
          <div className="border-t bg-white px-4 py-3 space-y-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="block rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                onClick={() => setMobileOpen(false)}
              >
                {l.label}
              </Link>
            ))}
            <Link
              href="/dashboard"
              className="flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
              onClick={() => setMobileOpen(false)}
            >
              Dashboard →
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}