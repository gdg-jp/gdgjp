import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // Pin to a fixed port so RP `.dev.vars` IDP_URL=http://localhost:5173 stays
  // correct regardless of which app `pnpm dev` starts first.
  server: { port: 5173, strictPort: true },
  // Pre-bundle the linked UI package before requests arrive. Discovering its
  // dependencies during SSR can invalidate modules already loaded by workerd.
  optimizeDeps: { include: ["@gdgjp/design-system"] },
  environments: {
    ssr: { optimizeDeps: { include: ["@gdgjp/design-system"] } },
  },
  plugins: [
    cloudflare({
      configPath: process.env.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH,
      viteEnvironment: { name: "ssr" },
      remoteBindings: false,
      inspectorPort: process.env.CI ? false : 9273,
    }),
    reactRouter(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  resolve: {
    dedupe: ["react", "react-dom", "react-router"],
  },
});
