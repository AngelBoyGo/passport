import Link from "next/link";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl px-6 py-8">
      <aside className="hidden w-56 shrink-0 md:block">
        <nav className="sticky top-20 space-y-1 text-sm">
          <p className="mb-2 font-semibold text-slate-900">Getting Started</p>
          <DocLink href="/docs/getting-started">Quickstart</DocLink>
          <p className="mb-2 mt-6 font-semibold text-slate-900">API Reference</p>
          <DocLink href="/docs/api-reference">Overview</DocLink>
          <p className="mb-2 mt-6 font-semibold text-slate-900">Guides</p>
          <DocLink href="/docs/integrations">Integrations</DocLink>
        </nav>
      </aside>
      <article className="min-w-0 flex-1 md:pl-12">{children}</article>
    </div>
  );
}

function DocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="block rounded px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    >
      {children}
    </Link>
  );
}