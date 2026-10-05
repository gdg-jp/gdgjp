import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  future: {
    v8_viteEnvironmentApi: true,
    // Scan route dependencies before hydration instead of discovering them mid-request.
    unstable_optimizeDeps: true,
  },
} satisfies Config;
