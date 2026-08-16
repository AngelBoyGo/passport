"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
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
    checkSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (authed === null) {
    const showError = checkError && pathname !== "/login";
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-sm text-slate-500">
        {showError ? (
          <>
            <p className="text-red-600">{checkError}</p>
            <button
              onClick={checkSession}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
            >
              Retry
            </button>
          </>
        ) : (
          <p>Loading…</p>
        )}
      </div>
    );
  }

  if (pathname === "/admin") {
    return <>{children}</>;
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8 flex items-center justify-between border-b pb-4">
        <div>
          <Link href="/admin" className="text-xl font-bold text-indigo-600">
            Passport Admin
          </Link>
          <p className="text-sm text-slate-500">Operator dashboard</p>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/admin" className="text-slate-600 hover:text-slate-900">
            Dashboard
          </Link>
          <Link href="/admin/api-keys" className="text-slate-600 hover:text-slate-900">
            API Keys
          </Link>
          <Link href="/admin/receipts" className="text-slate-600 hover:text-slate-900">
            Receipts
          </Link>
          <Link href="/" className="text-slate-600 hover:text-slate-900">
            Site
          </Link>
          <button
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              router.push("/login");
            }}
            className="text-red-600 hover:underline"
          >
            Logout
          </button>
        </nav>
      </header>
      {children}
    </div>
  );
}
