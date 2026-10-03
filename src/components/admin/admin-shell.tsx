"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

/**
 * Admin console shell.
 *
 * Audit fixes:
 *  - one consistent shell for ALL admin routes (previously `/admin` was a
 *    separate dark app and `/admin/brain` was white-on-white);
 *  - active-route highlight (was: every link identical);
 *  - Economy added to nav;
 *  - a real skeleton while the session resolves (was: a bare "Loading…").
 */
const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/passports", label: "Passports" },
  { href: "/admin/evidence", label: "Evidence" },
  { href: "/admin/economy", label: "Economy" },
  { href: "/admin/brain", label: "Brain" },
  { href: "/admin/api-keys", label: "API Keys" },
  { href: "/admin/receipts", label: "Receipts" },
  { href: "/admin/webhooks", label: "Webhooks" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [checkError, setCheckError] = useState("");

  async function checkSession() {
    setCheckError("");
    let res: Response;
    try {
      res = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
    } catch {
      setCheckError("Network error. Check your connection and try again.");
      return;
    }

    if (res.status === 401) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }

    if (!res.ok) {
      setCheckError(`Server error (${res.status}). Retrying…`);
      return;
    }

    let data: { authenticated?: boolean };
    try {
      data = await res.json();
    } catch {
      setCheckError("Invalid response from server.");
      return;
    }

    if (!data.authenticated) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }

    setAuthed(true);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- session check on route change
    checkSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Skeleton shell (not a bare "Loading…") while the session resolves.
  if (authed === null) {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="border-b bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <div className="h-6 w-40 animate-pulse rounded bg-slate-200" />
          </div>
        </header>
        <div className="mx-auto max-w-6xl px-6 py-8">
          {checkError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <p>{checkError}</p>
              <button
                onClick={checkSession}
                className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="h-8 w-56 animate-pulse rounded bg-slate-200" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-20 animate-pulse rounded-xl border bg-white" />
                ))}
              </div>
              <div className="h-64 animate-pulse rounded-xl border bg-white" />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div>
            <Link href="/admin" className="text-lg font-bold text-indigo-600">
              Passport Admin
            </Link>
            <p className="text-xs text-slate-500">Operator console</p>
          </div>
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={isActive(pathname, n.href) ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  isActive(pathname, n.href)
                    ? "bg-indigo-50 font-semibold text-indigo-700"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {n.label}
              </Link>
            ))}
            <Link href="/admin/change-password" className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">
              Password
            </Link>
            <Link href="/" className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">
              Site
            </Link>
            <button
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                window.location.assign("/login");
              }}
              className="rounded-md px-3 py-1.5 text-red-600 hover:bg-red-50"
            >
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
    </div>
  );
}
