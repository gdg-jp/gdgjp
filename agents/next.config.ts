import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@gdgjp/gdg-lib"],
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
