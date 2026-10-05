import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const devVarsPath = join(cwd, ".dev.vars.e2e");
const previousDevVars = existsSync(devVarsPath) ? readFileSync(devVarsPath) : null;
const environment = {
  ...process.env,
  CLOUDFLARE_ENV: "e2e",
  WIKI_E2E_SESSION_SECRET:
    process.env.WIKI_E2E_SESSION_SECRET ?? "wiki-e2e-session-secret-for-local-tests",
  WIKI_E2E_ISSUER:
    process.env.WIKI_E2E_ISSUER ?? `http://localhost:${process.env.CI ? 6173 : 5173}`,
  WIKI_E2E_PERSIST_TO: process.env.WIKI_E2E_PERSIST_TO ?? ".wrangler/e2e-state",
};

writeFileSync(
  devVarsPath,
  [
    `RP_SESSION_SECRET=${environment.WIKI_E2E_SESSION_SECRET}`,
    "IDP_CLIENT_SECRET=wiki-e2e-idp-client-secret",
    `APP_URL=http://localhost:${process.env.CI ? 6177 : 5177}`,
    `ACCOUNTS_URL=http://localhost:${process.env.CI ? 6173 : 5173}`,
    `IDP_URL=${environment.WIKI_E2E_ISSUER}`,
    "ENVIRONMENT=development",
    "",
  ].join("\n"),
  { mode: 0o600 },
);

const exitCode = await new Promise((resolve) => {
  const child = spawn("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)], {
    cwd,
    env: environment,
    stdio: "inherit",
  });
  child.on("error", () => resolve(1));
  child.on("close", (code) => resolve(code ?? 1));
});

if (previousDevVars === null) rmSync(devVarsPath, { force: true });
else writeFileSync(devVarsPath, previousDevVars, { mode: 0o600 });

process.exitCode = exitCode;
