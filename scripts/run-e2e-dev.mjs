import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve as resolvePath } from "node:path";

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

let previewDirectory;
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
  let args = ["dev", "--port", String(port), "--strictPort"];
  if (process.env.GDG_E2E_BUILT?.split(",").includes(basename(process.cwd()))) {
    const buildDirectory = resolvePath("build/server");
    const config = JSON.parse(readFileSync(join(buildDirectory, "wrangler.json"), "utf8"));
    config.name += "-e2e";
    config.main = resolvePath(buildDirectory, config.main);
    config.assets.directory = resolvePath(buildDirectory, config.assets.directory);
    config.services = config.services.map((binding) => ({
      ...binding,
      service: binding.service === "gdgjp-accounts" ? "gdgjp-accounts-e2e" : binding.service,
    }));
    mkdirSync(".wrangler", { recursive: true });
    previewDirectory = mkdtempSync(resolvePath(".wrangler/ci-preview-"));
    const previewConfig = join(previewDirectory, "wrangler.json");
    writeFileSync(previewConfig, JSON.stringify(config));
    // Keep secrets in a vars file so Wrangler redacts them in diagnostics.
    writeFileSync(join(previewDirectory, ".dev.vars"), readFileSync(varsPath), { mode: 0o600 });
    args = [
      "exec",
      "wrangler",
      "dev",
      "--config",
      previewConfig,
      "--local",
      "--port",
      String(port),
      "--inspector-port",
      "0",
      "--persist-to",
      resolvePath(process.env.WIKI_E2E_PERSIST_TO ?? ".wrangler/state"),
    ];
  }
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn("pnpm", args, {
      env: {
        ...process.env,
        // The preview config already has E2E names. Do not suffix them twice.
        CLOUDFLARE_ENV: previewDirectory ? undefined : "e2e",
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
  if (previewDirectory) rmSync(previewDirectory, { recursive: true, force: true });
  if (previousVars === null) rmSync(varsPath, { force: true });
  else writeFileSync(varsPath, previousVars, { mode: 0o600 });
  if (previousConfig === null) rmSync(configPath, { force: true });
  else writeFileSync(configPath, previousConfig);
}
