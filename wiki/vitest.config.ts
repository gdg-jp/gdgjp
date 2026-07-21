import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    passWithNoTests: true,
    include: [
      "app/**/*.test.{ts,tsx}",
      "shared/**/*.test.{ts,tsx}",
      "tests/unit/**/*.test.{ts,tsx}",
      "tests/golden/**/*.test.{ts,tsx}",
      "workers/**/*.test.{ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["app/**/*.{ts,tsx}", "shared/**/*.ts", "workers/**/*.ts"],
      exclude: [
        "app/**/*.test.{ts,tsx}",
        "shared/**/*.test.ts",
        "workers/**/*.test.{ts,tsx}",
        "app/routes/**",
        "tests/golden/**",
      ],
    },
  },
});
