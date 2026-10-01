// Audit fix M13: the docs advertise /api/v1/agents/economy-health but the real
// route lives at /api/v1/raillab/economy-health (ISSUER-auth). This thin alias
// keeps the published path working without duplicating logic.
//
// NOTE: Next.js forbids re-exporting the `dynamic` segment config, so we
// declare it locally and forward the handler call explicitly.
import { NextRequest } from "next/server";
import { GET as raillabGET } from "@/app/api/v1/raillab/economy-health/route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return raillabGET(request);
}
