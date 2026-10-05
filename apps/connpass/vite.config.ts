import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  build: { reportCompressedSize: false, target: ["edge88", "firefox78", "chrome87", "safari14"] },
  resolve: { tsconfigPaths: true },
  server: { port: 5179, strictPort: true },
  envPrefix: ["VITE_", "CONNPASS_E2E_"],
  plugins: [
    cloudflare({
      configPath: process.env.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH,
      viteEnvironment: { name: "ssr" },
      remoteBindings: false,
      inspectorPort: process.env.CI ? false : 9279,
    }),
    tailwindcss(),
    reactRouter(),
  ],
});
