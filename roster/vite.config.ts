import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: { port: 5186, strictPort: true },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" }, remoteBindings: false }),
    reactRouter(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  // `@gdgjp/gdg-lib` is consumed as source; without dedupe + eagerly optimizing
  // the React-dependent libs it pulls in, the client ends up with two React
  // copies → "invalid hook call" at hydration (see ost/vite.config.ts, which
  // this block is copied from per ADR-001). Stage 01 doesn't render any
  // `@gdgjp/gdg-lib/ui` component yet, so radix-ui / lucide-react / motion
  // aren't roster dependencies (and aren't in this list) — add them back here
  // if a later stage renders shared UI that pulls them in.
  resolve: { dedupe: ["react", "react-dom", "react-router"] },
  optimizeDeps: {
    include: ["react", "react-dom", "react-dom/client", "react-router"],
  },
});
