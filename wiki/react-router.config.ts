import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // Fetchers must match their API route before the first dialog interaction.
  routeDiscovery: { mode: "initial" },
  future: {
    v8_viteEnvironmentApi: true,
    // Scan route dependencies before hydration instead of discovering them mid-request.
    unstable_optimizeDeps: true,
  },
} satisfies Config;
