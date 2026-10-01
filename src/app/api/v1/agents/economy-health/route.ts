// Audit fix M13: the docs advertise /api/v1/agents/economy-health but the real
// route lives at /api/v1/raillab/economy-health. This thin alias keeps the
// published contract working without duplicating logic.
export { GET, dynamic } from "@/app/api/v1/raillab/economy-health/route";
