import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["app/**/*.{test,spec}.{ts,tsx}", "tests/architecture/**/*.test.ts"],
    exclude: ["node_modules", "build", ".react-router", "e2e"],
  },
});
