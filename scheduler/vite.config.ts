import { reactRouter } from "@react-router/dev/vite";
import { cloudflareDevProxy } from "@react-router/dev/vite/cloudflare";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { CloudflareContext } from "./workers/context";

export default defineConfig({
  build: { reportCompressedSize: false, target: ["edge88", "firefox78", "chrome87", "safari14"] },
  resolve: { tsconfigPaths: true },
  server: { port: 5176 },
  plugins: [
    cloudflareDevProxy({
      environment: process.env.CLOUDFLARE_ENV,
      configPath: process.env.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH,
      getLoadContext: ({ context }) =>
        new CloudflareContext({
          env: context.cloudflare.env as Env,
          ctx: context.cloudflare.ctx,
        }),
    }),
    tailwindcss(),
    reactRouter(),
  ],
});
