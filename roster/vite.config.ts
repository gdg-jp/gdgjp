import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: { port: 5186, strictPort: true },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" }, remoteBindings: false, inspectorPort: 9286 }),
    reactRouter(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  // `@gdgjp/gdg-lib` is consumed as source; without dedupe + eagerly optimizing
  // the React-dependent libs it pulls in, the client ends up with two React
  // copies → "invalid hook call" at hydration (see ost/vite.config.ts, which
  // this block is copied from per ADR-001). The app shell renders shared menu
  // components, so their React-dependent libraries must be eagerly optimized.
  // Add motion here too if a future shared component starts pulling it in.
  resolve: { dedupe: ["react", "react-dom", "react-router"] },
  optimizeDeps: {
    include: ["react", "react-dom", "react-dom/client", "react-router", "radix-ui", "lucide-react"],
  },
});
