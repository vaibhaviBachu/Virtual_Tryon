import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output keeps the production Docker image small (only the traced
  // dependency subset is copied in, per infrastructure/docker conventions).
  output: "standalone",
};

export default nextConfig;
