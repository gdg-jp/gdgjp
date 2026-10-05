import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["{app,workers}/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "build", ".react-router", "e2e"],
  },
});
