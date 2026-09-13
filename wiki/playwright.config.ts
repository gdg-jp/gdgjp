import { relative } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import {
  DEFAULT_E2E_PERSISTENCE_PATH,
  E2E_PERSISTENCE_ENV,
  resolveE2EPersistencePath,
} from "./tests/e2e/setup";

const e2ePersistencePath = resolveE2EPersistencePath(
  process.env[E2E_PERSISTENCE_ENV] ?? DEFAULT_E2E_PERSISTENCE_PATH,
);
const e2ePersistenceValue = relative(process.cwd(), e2ePersistencePath);
process.env[E2E_PERSISTENCE_ENV] = e2ePersistenceValue;
const webServerEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== undefined),
) as Record<string, string>;
webServerEnvironment[E2E_PERSISTENCE_ENV] = e2ePersistenceValue;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI || process.env[E2E_PERSISTENCE_ENV] ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:5177",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5177",
    env: webServerEnvironment,
    reuseExistingServer: false,
    // The wiki dev server (vite + cloudflare plugin + workerd) cold-starts
    // slower than playwright's default 60s when CI is also pulling deps;
    // give it more headroom rather than masking timeouts as test failures.
    timeout: 180_000,
  },
});
