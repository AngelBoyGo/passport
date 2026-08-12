type AdminCandidate = { email?: string | null };

export function executiveAdminEmails(): string[] {
  return (process.env.ADMIN_OPERATOR_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isExecutiveAdmin(operator: AdminCandidate): boolean {
  const allowlist = executiveAdminEmails();
  if (allowlist.length === 0) return process.env.NODE_ENV !== "production";
  return Boolean(operator.email && allowlist.includes(operator.email.toLowerCase().trim()));
}
