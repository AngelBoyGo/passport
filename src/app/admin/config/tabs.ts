export const ADMIN_TABS = [
  { id: "command-center", label: "Command Center", eyebrow: "CEO", description: "System pulse and operator outcomes" },
  { id: "trust-operations", label: "Trust Operations", eyebrow: "Risk", description: "Enrollment, evidence, and receipts" },
  { id: "economy", label: "Economy", eyebrow: "CFO", description: "Credits, escrow, and slashing" },
  { id: "reliability", label: "Reliability", eyebrow: "CTO", description: "Health and operational readiness" },
];

export type AdminTabId = (typeof ADMIN_TABS)[number]["id"];
