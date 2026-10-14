import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Monorepo root, so traced dependency paths resolve to the hoisted pnpm store.
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
