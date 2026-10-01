// Audit fix M13: docs advertise /api/v1/verify/public-key; the real public-key
// surface is /api/v1/transparency/keys. Thin alias preserving the contract.
//
// NOTE: Next.js forbids re-exporting the `dynamic` segment config, so we
// declare it locally and forward the handler call explicitly.
import { GET as keysGET } from "@/app/api/v1/transparency/keys/route";

export const dynamic = "force-dynamic";

export async function GET() {
  return keysGET();
}
