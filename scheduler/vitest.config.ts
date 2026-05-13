import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["app/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "build", ".react-router", "e2e"],
  },
});
