import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkspaceSnapshot } from "./verification/workspace-snapshot.mjs";

const ports = {
  accounts: [6173],
  tinyurl: [6173, 6174],
  img: [6173, 6175],
  scheduler: [6173, 6176],
  wiki: [6177],
  sns: [6173, 6178],
  connpass: [6179, 6181],
  website: [6180],
  pay: [6182],
  ost: [6185],
  roster: [6186],
  mc: [6187],
  screen: [6188],
  deck: [6189, 4467],
  roulette: [6190],
  pr: [6191, 5298, 5299],
  "design-system": [6016, 6017],
};
const applicationPorts = Object.fromEntries(
  Object.entries(ports)
    .filter(([name]) => name !== "design-system")
    .map(([name, values]) => [name, values.find((port) => port !== 6173) ?? 6173]),
);
const builtPreviews = new Set([
  "accounts",
  "tinyurl",
  "img",
  "scheduler",
  "wiki",
  "roster",
  "ost",
  "mc",
  "deck",
  "screen",
  "roulette",
]);

export async function assertPortsAvailable(portNumbers) {
  for (const port of new Set(portNumbers)) {
    for (const host of ["127.0.0.1", "::1"]) {
      await new Promise((done, reject) => {
        const server = createServer();
        server.once("error", (error) =>
          error.code === "EADDRNOTAVAIL"
            ? done()
            : reject(
                new Error(`E2E port ${port} on ${host} is occupied; its owner was not stopped`),
              ),
        );
        server.listen(port, host, () => server.close(done));
      });
    }
  }
}

function fixtureVariables(snapshot) {
  const secret = "ci-idp-client-secret";
  const accounts = {
    BETTER_AUTH_SECRET: "ci-better-auth-secret-for-e2e-tests",
    GOOGLE_CLIENT_ID: "ci-google-client-id",
    GOOGLE_CLIENT_SECRET: "ci-google-client-secret",
    E2E_TEST_MODE: "true",
    APP_URL: "http://localhost:6173",
  };
  for (const { path, manifest } of snapshot.workspaces.filter(({ path }) =>
    path.startsWith("apps/"),
  )) {
    const name = manifest.name.split("/").at(-1);
    const port = applicationPorts[name];
    if (!port) continue;
    const prefix = name.replaceAll("-", "_").toUpperCase();
    accounts[`${prefix}_CLIENT_ID`] = name;
    accounts[`${prefix}_CLIENT_SECRET`] = secret;
    accounts[`${prefix}_REDIRECT_URLS`] = `http://localhost:${port}/api/auth/callback/gdgjp`;
    const variables = {
      RP_SESSION_SECRET: name === "wiki" ? "ci-wiki-e2e-session-secret" : "ci-rp-session-secret",
      IDP_CLIENT_SECRET: secret,
      IDP_CLIENT_ID: name,
      APP_URL: `http://localhost:${port}`,
      ACCOUNTS_URL: "http://localhost:6173",
      IDP_URL: "http://localhost:6173",
      ENVIRONMENT: "development",
      RUNNER_TOKEN: "ci-pr-runner-token-0123456789abcdef0123",
      SETTINGS_ENCRYPTION_KEY: "ci-pr-settings-key-0123456789abcdef",
      INTERNAL_API_SECRET: "ci-internal-api-secret",
      SHORT_URL_BASE: `http://localhost:${port}`,
      PR_RENDER_URL: "http://127.0.0.1:5298/snapshot",
    };
    writeFileSync(
      join(snapshot.root, path, ".dev.vars"),
      Object.entries(variables)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n")
        .concat("\n"),
      { mode: 0o600 },
    );
  }
  if (existsSync(join(snapshot.root, "apps/accounts"))) {
    writeFileSync(
      join(snapshot.root, "apps/accounts/.dev.vars"),
      Object.entries(accounts)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n")
        .concat("\n"),
      { mode: 0o600 },
    );
  }
}

export async function runIsolatedE2E({ source, workspace, playwrightArgs = [] }) {
  source = resolve(source);
  const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const evidence = join(source, "local_data/pstack/e2e", runId);
  mkdirSync(evidence, { recursive: true });
  const output = createWriteStream(join(evidence, "tests.log"));
  let snapshot;
  let child;
  let signal;
  let exitCode = 1;
  const results = [];
  let selected = [];
  const reports = [];
  const stop = (value) => {
    signal = value;
    if (child?.pid) {
      try {
        if (process.platform === "win32") child.kill(value);
        else process.kill(-child.pid, value);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  };
  const interrupt = () => stop("SIGINT");
  const terminate = () => stop("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  async function execute(args, environment) {
    if (signal) return signal === "SIGINT" ? 130 : 143;
    output.write(`\n$ pnpm ${args.join(" ")}\n`);
    child = spawn("pnpm", args, {
      cwd: snapshot.root,
      env: environment,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (data) => {
        output.write(data);
        process.stdout.write(data);
      });
    const code = await new Promise((done) => {
      child.once("error", (error) => {
        output.write(`${error.message}\n`);
        done(1);
      });
      child.once("close", (code, ending) =>
        done(
          code ??
            ((signal ?? ending) === "SIGINT" ? 130 : (signal ?? ending) === "SIGTERM" ? 143 : 1),
        ),
      );
    });
    results.push({ args, exitCode: code });
    child = undefined;
    return code;
  }
  try {
    exitCode = await (async () => {
      snapshot = createWorkspaceSnapshot(source);
      const configured = snapshot.workspaces.filter(
        ({ manifest }) => manifest.scripts?.["test:e2e"],
      );
      selected = workspace
        ? configured.filter(({ manifest }) => manifest.name === workspace)
        : configured;
      if (!selected.length)
        throw new Error(`No E2E workspace selected${workspace ? ` for ${workspace}` : ""}`);
      await assertPortsAvailable(
        selected.flatMap(({ manifest }) => ports[manifest.name.split("/").at(-1)] ?? []),
      );
      fixtureVariables(snapshot);
      const registry = join(snapshot.root, ".e2e-registry");
      mkdirSync(registry);
      const configuredNode =
        process.env.GDG_CI_NODE ??
        spawnSync("git", ["config", "--local", "--get", "gdgjp.ciNode"], {
          cwd: source,
          encoding: "utf8",
        }).stdout?.trim();
      if (configuredNode && !existsSync(configuredNode))
        throw new Error(`Configured Node runtime is missing: ${configuredNode}`);
      const environment = {
        PATH: configuredNode ? `${dirname(configuredNode)}:${process.env.PATH}` : process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        CI: "true",
        WRANGLER_SEND_METRICS: "false",
        MINIFLARE_REGISTRY_PATH: registry,
        WRANGLER_REGISTRY_PATH: registry,
        GDG_E2E_DEPENDENCIES: join(source, "node_modules"),
        WIKI_E2E_SESSION_SECRET: "ci-wiki-e2e-session-secret",
        WIKI_E2E_ISSUER: "http://localhost:6173",
        PR_REAL_SERVICES: "",
        PLAYWRIGHT_JSON_OUTPUT_NAME: ".turbo/ci-playwright.json",
      };
      writeFileSync(
        join(evidence, "run.json"),
        JSON.stringify(
          {
            source,
            scratch: snapshot.root,
            workspace: workspace ?? null,
            selected: selected.map(({ manifest }) => manifest.name),
            hashes: snapshot.hashes,
            revisions: snapshot.revisions,
          },
          null,
          2,
        ),
      );
      console.log(`Isolated E2E evidence: ${evidence}`);
      const migrations = new Set(
        selected
          .map(({ manifest }) => manifest.name.split("/").at(-1))
          .filter((name) => ["accounts", "tinyurl", "img"].includes(name)),
      );
      if (
        selected.some(({ manifest }) =>
          ["tinyurl", "img", "scheduler", "sns"].includes(manifest.name.split("/").at(-1)),
        )
      )
        migrations.add("accounts");
      for (const name of migrations) {
        exitCode = await execute(["--filter", `@gdgjp/${name}`, "migrate:local"], environment);
        if (exitCode) return exitCode;
      }
      const builds = selected
        .filter(({ manifest }) => builtPreviews.has(manifest.name.split("/").at(-1)))
        .map(({ manifest }) => manifest.name);
      if (migrations.has("accounts") && !builds.includes("@gdgjp/accounts"))
        builds.push("@gdgjp/accounts");
      if (builds.length) {
        exitCode = await execute(
          [
            "exec",
            "turbo",
            "build",
            "--concurrency=2",
            "--env-mode=loose",
            ...builds.map((name) => `--filter=${name}`),
          ],
          environment,
        );
        if (exitCode) return exitCode;
      }
      environment.GDG_E2E_BUILT = builds.map((name) => name.split("/").at(-1)).join(",");
      const testArguments = [...playwrightArgs];
      let reporterFound = false;
      for (let index = 0; index < testArguments.length; index++) {
        const argument = testArguments[index];
        if (argument === "--reporter" && testArguments[index + 1]) {
          const reporters = new Set(testArguments[index + 1].split(","));
          reporters.add("json");
          testArguments[++index] = [...reporters].join(",");
          reporterFound = true;
        } else if (argument.startsWith("--reporter=")) {
          const reporters = new Set(argument.slice("--reporter=".length).split(","));
          reporters.add("json");
          testArguments[index] = `--reporter=${[...reporters].join(",")}`;
          reporterFound = true;
        }
      }
      if (!reporterFound) testArguments.push("--reporter=dot,json");
      exitCode = await execute(
        [
          "exec",
          "turbo",
          "test:e2e",
          "--concurrency=1",
          "--continue=always",
          "--env-mode=loose",
          ...(workspace ? [`--filter=${workspace}`] : []),
          "--",
          ...testArguments,
        ],
        environment,
      );
      return exitCode;
    })();
  } catch (error) {
    exitCode = 1;
    output.write(`${error.stack ?? error.message}\n`);
    console.error(error.message);
  } finally {
    try {
      if (snapshot) {
        for (const { path } of snapshot.workspaces) {
          for (const report of ["playwright-report", "test-results"]) {
            const from = join(snapshot.root, path, report);
            if (existsSync(from))
              cpSync(from, join(evidence, path, report), {
                recursive: true,
                filter: (file) => !file.split(/[\\/]/).includes("storage-state"),
              });
          }
          const json = join(snapshot.root, path, ".turbo/ci-playwright.json");
          let counts = null;
          if (existsSync(json)) {
            const destination = join(evidence, path, ".turbo/ci-playwright.json");
            mkdirSync(dirname(destination), { recursive: true });
            cpSync(json, destination);
            try {
              const stats = JSON.parse(readFileSync(json, "utf8")).stats;
              if (stats)
                counts = {
                  passed: stats.expected,
                  failed: stats.unexpected,
                  skipped: stats.skipped,
                  flaky: stats.flaky,
                };
            } catch {}
          }
          if (selected.some((workspace) => workspace.path === path))
            reports.push({ workspace: path, counts, directory: join(evidence, path) });
        }
      }
    } catch (error) {
      exitCode = 1;
      output.write(`Report collection failed: ${error.message}\n`);
    }
    try {
      snapshot?.dispose();
    } catch (error) {
      exitCode = 1;
      output.write(`Snapshot cleanup failed: ${error.message}\n`);
    }
    if (signal) exitCode = signal === "SIGINT" ? 130 : 143;
    if (
      exitCode === 0 &&
      reports.some(
        ({ counts }) =>
          !counts || !Number.isInteger(counts.passed) || counts.passed < 1 || counts.failed > 0,
      )
    )
      exitCode = 1;
    output.end();
    const resultPath = join(evidence, "result.json");
    writeFileSync(
      resultPath,
      JSON.stringify(
        {
          evidence,
          status: exitCode === 0 ? "VERIFIED" : "NOT VERIFIED",
          exitCode,
          signal: signal ?? null,
          selected: selected.map(({ manifest }) => manifest.name),
          reports,
          steps: results,
          scratchCleaned: !snapshot || !existsSync(snapshot.root),
        },
        null,
        2,
      ),
    );
    console.log(`isolated-e2e-result=${resultPath}`);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
  return exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    let workspace;
    let playwrightArgs = [];
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index++) {
      if (args[index] === "--") {
        playwrightArgs = args.slice(index + 1);
        break;
      }
      if ((args[index] === "--source" || args[index] === "--workspace") && args[index + 1]) {
        if (args[index] === "--source") source = resolve(args[++index]);
        else workspace = args[++index];
      } else throw new Error(`Unknown argument: ${args[index]}`);
    }
    process.exitCode = await runIsolatedE2E({ source, workspace, playwrightArgs });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
