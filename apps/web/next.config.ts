import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TS source (no build step), so Next must transpile them.
  transpilePackages: ["@verdant/db", "@verdant/contracts"],
};

export default nextConfig;
