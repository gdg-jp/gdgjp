import { defineConfig, devices } from "@playwright/test";

const ACCOUNTS_URL = process.env.E2E_ACCOUNTS_URL;
if (!ACCOUNTS_URL?.startsWith("https://"))
  throw new Error("E2E_ACCOUNTS_URL must be the deployed Accounts origin");
if (!process.env.E2E_RP_URLS) throw new Error("E2E_RP_URLS must list deployed relying parties");
if (!process.env.E2E_ACCOUNTS_D1?.startsWith("remote:"))
  throw new Error("E2E_ACCOUNTS_D1 must name the deployed Accounts database");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "rp-sign-in.spec.ts",
  forbidOnly: true,
  retries: 1,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: ACCOUNTS_URL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
