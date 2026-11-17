import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // workers-oauth-provider imports WorkerEntrypoint from the Workers runtime.
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("./tests/cloudflare-workers.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    globals: true,
    // Bundle it so the alias above applies to its import.
    server: { deps: { inline: ["@cloudflare/workers-oauth-provider"] } },
  },
});
