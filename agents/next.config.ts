import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@gdgjp/gdg-lib"],
  // Monorepo root, so traced dependency paths (e.g. hoisted pnpm store
  // entries outside agents/) resolve consistently for `vercel build` /
  // `vercel deploy --prebuilt` instead of drifting relative to cwd.
  outputFileTracingRoot: path.join(__dirname, ".."),
  // discord.js pulls optional native deps; keep them outside the webpack bundle.
  serverExternalPackages: [
    "discord.js",
    "@discordjs/ws",
    "zlib-sync",
    "ioredis",
    "@chat-adapter/discord",
    "@chat-adapter/gchat",
    "@chat-adapter/state-ioredis",
  ],
};

export default nextConfig;
