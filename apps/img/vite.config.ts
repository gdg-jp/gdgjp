import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  build: { reportCompressedSize: false, target: ["edge88", "firefox78", "chrome87", "safari14"] },
  resolve: { tsconfigPaths: true, dedupe: ["react", "react-dom", "react-router"] },
  server: { port: 5175 },
  cacheDir: process.env.CI ? "node_modules/.vite-e2e" : undefined,
  optimizeDeps: { include: ["@gdgjp/design-system"] },
  environments:
    command === "serve"
      ? { ssr: { optimizeDeps: { include: ["@gdgjp/design-system"] } } }
      : undefined,
  plugins: [
    cloudflare({
      configPath: process.env.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH,
      viteEnvironment: { name: "ssr" },
      remoteBindings: false,
      inspectorPort: process.env.CI ? false : 9275,
    }),
    tailwindcss(),
    reactRouter(),
  ],
}));
