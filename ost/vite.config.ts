import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5185, strictPort: true },
  plugins: [
    cloudflare({
      configPath: process.env.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH,
      viteEnvironment: { name: "ssr" },
      remoteBindings: false,
      inspectorPort: process.env.CI ? false : 9285,
    }),
    reactRouter(),
    tailwindcss(),
  ],
  // `@gdgjp/gdg-lib` is consumed as source; without dedupe + eagerly optimizing
  // the React-dependent libs it pulls in (radix-ui, lucide, motion), the client
  // ends up with two React copies → "invalid hook call" at hydration.
  resolve: { tsconfigPaths: true, dedupe: ["react", "react-dom", "react-router"] },
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
  build: {
    reportCompressedSize: false,
    target: ["edge88", "firefox78", "chrome87", "safari14"],
    rolldownOptions: { output: { keepNames: true } },
  },
});
