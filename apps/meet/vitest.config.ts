import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const designSystemNodeModules = (pkg: string) =>
  fileURLToPath(new URL(`../../packages/design-system/node_modules/${pkg}`, import.meta.url));

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // Keep Vitest on the same React instance that @gdgjp/design-system and its
    // Radix / Lucide peer dependencies resolve against in pnpm's store.
    alias: [
      { find: /^react$/, replacement: designSystemNodeModules("react") },
      { find: /^react\/(.+)$/, replacement: `${designSystemNodeModules("react")}/$1` },
      { find: /^react-dom$/, replacement: designSystemNodeModules("react-dom") },
      { find: /^react-dom\/(.+)$/, replacement: `${designSystemNodeModules("react-dom")}/$1` },
    ],
  },
  test: {
    environment: "node",
    include: [
      "app/**/*.{test,spec}.{ts,tsx}",
      "workers/**/*.{test,spec}.{ts,tsx}",
      "tests/**/*.test.ts",
    ],
    exclude: ["node_modules", "build", ".react-router", "e2e"],
  },
});
