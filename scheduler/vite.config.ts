import { reactRouter } from "@react-router/dev/vite";
import { cloudflareDevProxy } from "@react-router/dev/vite/cloudflare";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { CloudflareContext } from "./workers/context";

export default defineConfig({
  server: { port: 5176 },
  plugins: [
    cloudflareDevProxy({
      getLoadContext: ({ context }) =>
        new CloudflareContext({
          env: context.cloudflare.env as Env,
          ctx: context.cloudflare.ctx,
        }),
    }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
});
