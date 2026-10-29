import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  build: { reportCompressedSize: false, target: ["edge88", "firefox78", "chrome87", "safari14"] },
  server: { port: 5190, strictPort: true },
  plugins: [
    cloudflare({
      configPath: process.env.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH,
      viteEnvironment: { name: "ssr" },
      remoteBindings: false,
      inspectorPort: process.env.CI ? false : 9290,
    }),
    reactRouter(),
    tailwindcss(),
  ],
  // `@gdgjp/gdg-lib` is consumed as source; dedupe React so hydration sees one
  // copy (same block as ost/roster/mc/screen).
  resolve: { tsconfigPaths: true, dedupe: ["react", "react-dom", "react-router"] },
  optimizeDeps: {
    include: ["react", "react-dom", "react-dom/client", "react-router", "radix-ui", "lucide-react"],
  },
});
