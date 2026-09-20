import { redirect } from "next/navigation";

/**
 * Convenience alias: /admin/economy → the Economy tab of the executive console.
 * The dashboard is a tab (not a separate route), so this prevents a bare 404 on
 * the intuitive path.
 */
export default function AdminEconomyRedirect() {
  redirect("/admin?tab=economy");
}
