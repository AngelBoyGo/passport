import Link from "next/link";

const footerLinks = [
  {
    title: "Product",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/#pricing", label: "Pricing" },
      { href: "/docs/getting-started", label: "Quickstart" },
      { href: "/docs/api-reference", label: "API Reference" },
      { href: "/playground", label: "API Playground" },
    ],
  },
  {
    title: "Explore",
    links: [
      { href: "/agents", label: "Agent Embassy" },
      { href: "/leaderboard", label: "Leaderboard" },
      { href: "/docs/integrations", label: "Integrations" },
      { href: "/security", label: "Security" },
    ],
  },
  {
    title: "Verify",
    links: [
      { href: "/public-key", label: "Public Key" },
      { href: "/badge", label: "Agent Badge" },
      { href: "/verify/demo", label: "Verify an Agent" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/.well-known/bill-of-rights.json", label: "AI Bill of Rights" },
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms of Service" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {footerLinks.map((group) => (
            <div key={group.title}>
              <h4 className="mb-3 text-sm font-semibold text-slate-900">
                {group.title}
              </h4>
              <ul className="space-y-2">
                {group.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-sm text-slate-600 hover:text-slate-900"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 border-t pt-6 text-center text-xs text-slate-400">
          Passport — tamper-evident behavioral receipts for AI agents. Not
          unforgeable. Verifiable.
        </div>
      </div>
    </footer>
  );
}
