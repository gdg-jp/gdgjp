import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: { port: 5185, strictPort: true },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" }, remoteBindings: false }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
  // Keep the `OstBoard` class name through bundling so it still matches the
  // `new_sqlite_classes` entry in wrangler.toml after deploy.
  esbuild: { keepNames: true },
});
