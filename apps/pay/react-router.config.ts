import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  future: {
    v8_viteEnvironmentApi: true,
    unstable_optimizeDeps: true,
    v8_middleware: true,
  },
} satisfies Config;
