import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: { port: 5179, strictPort: true },
  envPrefix: ["VITE_", "CONNPASS_E2E_"],
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" }, remoteBindings: false }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
});
