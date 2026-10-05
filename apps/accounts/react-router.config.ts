import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  future: {
    v8_viteEnvironmentApi: true,
    // Scan all registered routes before the first request so hydration uses
    // one dependency-optimizer generation, including the shared UI shell.
    unstable_optimizeDeps: true,
  },
} satisfies Config;
