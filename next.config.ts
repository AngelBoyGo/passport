import type { NextConfig } from "next";
import { PRODUCTION_SECURITY_HEADERS } from "./src/lib/security/cors";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...PRODUCTION_SECURITY_HEADERS],
      },
    ];
  },
};

export default nextConfig;
