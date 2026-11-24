import { defineConfig, devices } from "@playwright/test";

if (!process.env.UI_FUZZ_TARGETS)
  throw new Error("UI_FUZZ_TARGETS must list app=https://origin pairs");

export default defineConfig({
  testDir: ".",
  testMatch: "*.fuzz.ts",
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: "../test-results/fuzz.json" }],
    ["html", { open: "never" }],
  ],
  outputDir: "../test-results/fuzz",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
