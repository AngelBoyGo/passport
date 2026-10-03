import type { Metadata } from "next";
import AdminShell from "@/components/admin/admin-shell";

export const metadata: Metadata = {
  title: "Admin Console — Passport",
  description: "Passport operator console: passports, evidence, brain, and economy.",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
