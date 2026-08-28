import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: { port: 5185, strictPort: true },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" }, remoteBindings: false }),
    reactRouter(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  // `@gdgjp/gdg-lib` is consumed as source; without dedupe + eagerly optimizing
  // the React-dependent libs it pulls in (radix-ui, lucide, motion), the client
  // ends up with two React copies → "invalid hook call" at hydration.
  resolve: { dedupe: ["react", "react-dom", "react-router"] },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react-router",
      "radix-ui",
      "lucide-react",
      "motion",
      "motion/react",
    ],
  },
  // Keep the `OstBoard` class name through bundling so it still matches the
  // `new_sqlite_classes` entry in wrangler.toml after deploy.
  esbuild: { keepNames: true },
});
