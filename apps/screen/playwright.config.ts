import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.CI ? 6188 : 5188;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./e2e/global-setup.ts",
  // Specs share the dev D1 and stage Durable Objects.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html"]] : "html",
  timeout: 45_000,
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    // Speaker pages follow Accept-Language; the specs assert Japanese copy.
    locale: "ja-JP",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--autoplay-policy=no-user-gesture-required",
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--auto-select-desktop-capture-source=Entire screen",
          ],
        },
      },
    },
  ],
  webServer: {
    command: process.env.CI ? `node ../../scripts/run-e2e-dev.mjs ${PORT}` : "pnpm dev",
    port: PORT,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
