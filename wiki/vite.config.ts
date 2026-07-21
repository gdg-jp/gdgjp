import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import agents from "agents/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // Pin to a fixed port so the IdP redirect URL
  // (http://localhost:5177/api/auth/oauth2/callback/gdgjp registered in
  // accounts/.dev.vars.example) and wiki/.dev.vars APP_URL stay correct
  // regardless of which app `pnpm dev` starts first.
  server: { port: 5177, strictPort: true },
  plugins: [
    agents(),
    cloudflare({ viteEnvironment: { name: "ssr" }, remoteBindings: false }),
    reactRouter(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  resolve: {
    dedupe: ["react", "react-dom", "react-router"],
  },
  // Durable Object and Workflow class names are part of Wrangler's deployment
  // contract, so retain them when the Worker bundle is transformed.
  esbuild: {
    keepNames: true,
  },
  build: {
    rollupOptions: {
      external: ["cloudflare:email"],
    },
  },
});
