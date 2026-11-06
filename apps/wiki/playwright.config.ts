import { relative } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import {
  DEFAULT_E2E_PERSISTENCE_PATH,
  E2E_PERSISTENCE_ENV,
  resolveE2EPersistencePath,
} from "./tests/e2e/setup";

const PORT = process.env.CI ? 6177 : 5177;
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
process.env.BASE_URL = BASE_URL;

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
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Tests must not depend on the internet: third-party assets (analytics, sibling-app
        // icons) fail fast instead of holding the page's load event on a slow network.
        launchOptions: {
          args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"],
        },
      },
    },
  ],
  webServer: {
    command: process.env.CI ? `node ../../scripts/run-e2e-dev.mjs ${PORT}` : "pnpm dev",
    // A static asset: readiness must not depend on the database, which globalSetup
    // migrates only after the server is up.
    url: `http://localhost:${PORT}/og-image.png`,
    env: webServerEnvironment,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    reuseExistingServer: false,
    // The wiki dev server (vite + cloudflare plugin + workerd) cold-starts
    // slower than playwright's default 60s when CI is also pulling deps;
    // give it more headroom rather than masking timeouts as test failures.
    timeout: 180_000,
  },
});
