import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 6100 || port > 6199) {
  throw new Error("CI E2E requires a 61xx port");
}

// Keep the running 51xx dev server's vars intact. Both Cloudflare Vite APIs
// select this separate file through the e2e environment.
const varsPath = ".dev.vars.e2e";
const previousVars = existsSync(varsPath) ? readFileSync(varsPath) : null;
const configPath = resolvePath(".wrangler.e2e.toml");
const previousConfig = existsSync(configPath) ? readFileSync(configPath) : null;
const sourcePath = process.env.CLOUDFLARE_ENV === "e2e" ? varsPath : ".dev.vars";
const source = existsSync(sourcePath) ? readFileSync(sourcePath, "utf8") : "";
const accountsUrl = "http://localhost:6173";
writeFileSync(
  varsPath,
  [
    source.replaceAll(/(https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):)51(\d{2})\b/g, "$161$2"),
    `APP_URL=http://localhost:${port}`,
    `ACCOUNTS_URL=${accountsUrl}`,
    `IDP_URL=${process.env.WIKI_E2E_ISSUER ?? accountsUrl}`,
    `SHORT_URL_BASE=http://localhost:${port}`,
    "ENVIRONMENT=development",
    `RP_SESSION_SECRET=${process.env.WIKI_E2E_SESSION_SECRET ?? "gdgjp-e2e-session-secret"}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);

try {
  // Named environments suffix Worker names; point service bindings at those
  // names too, so a running dev Accounts worker cannot receive CI requests.
  writeFileSync(
    configPath,
    readFileSync("wrangler.toml", "utf8").replaceAll(
      /^(\s*service\s*=\s*")gdgjp-accounts("\s*)$/gm,
      "$1gdgjp-accounts-e2e$2",
    ),
  );
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["dev", "--port", String(port), "--strictPort"], {
      env: {
        ...process.env,
        CLOUDFLARE_ENV: "e2e",
        CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: configPath,
      },
      stdio: "inherit",
    });
    const interrupt = () => child.kill("SIGINT");
    const terminate = () => child.kill("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    child.on("error", reject);
    child.on("close", (code) => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
      resolve(code ?? 1);
    });
  });
} finally {
  if (previousVars === null) rmSync(varsPath, { force: true });
  else writeFileSync(varsPath, previousVars, { mode: 0o600 });
  if (previousConfig === null) rmSync(configPath, { force: true });
  else writeFileSync(configPath, previousConfig);
}
