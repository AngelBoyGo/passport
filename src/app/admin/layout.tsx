"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => {
        if (!res.ok) throw new Error("not authenticated");
        return res.json();
      })
      .then((data) => setAuthed(data.authenticated))
      .catch(() => {
        setAuthed(false);
        router.push("/login");
      });
  }, [pathname, router]);

  if (authed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  if (!authed) {
    return null;
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