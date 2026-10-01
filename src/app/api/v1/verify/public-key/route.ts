// Audit fix M13: docs advertise /api/v1/verify/public-key; the real public-key
// surface is /api/v1/transparency/keys. Thin alias to preserve the contract.
export { GET, dynamic } from "@/app/api/v1/transparency/keys/route";
