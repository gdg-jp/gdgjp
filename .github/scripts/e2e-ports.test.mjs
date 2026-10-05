import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { changedSteps } from "../../scripts/run-ci.mjs";
import { classifyChanges } from "./changed-workspaces.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ports = {
  accounts: 5173,
  tinyurl: 5174,
  img: 5175,
  scheduler: 5176,
  wiki: 5177,
  connpass: 5179,
  pay: 5182,
  ost: 5185,
  roster: 5186,
};

test("shared E2E runner changes select browser checks and their regression test", () => {
  const steps = changedSteps("full", ["scripts/run-e2e-dev.mjs"]);
  for (const app of Object.keys(ports)) {
    assert.equal(steps.find(([name]) => name === `e2e:@gdgjp/${app}`)[2].CI, "true");
  }
  assert.match(steps.find(([name]) => name === "test:scripts")[1], /e2e-ports\.test\.mjs/);
  const hosted = classifyChanges(["scripts/run-e2e-dev.mjs"]);
  assert.ok(hosted.e2e.includes("accounts"));
  assert.ok(hosted.e2e.includes("tinyurl"));
  assert.equal(hosted.scriptTests, true);
  assert.deepEqual(hosted.deploy, []);
});

test("E2E readiness, browser origins and server commands agree in CI and local runs", () => {
  for (const CI of [undefined, "true"]) {
    for (const [app, devPort] of Object.entries(ports)) {
      const filename = join(root, "apps", app, "playwright.config.ts");
      const require = createRequire(filename);
      const exports = {};
      const env = { CI };
      const code = ts.transpileModule(readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      new Function("require", "exports", "process", code)(
        (specifier) => require(specifier === "./tests/e2e/setup" ? `${specifier}.ts` : specifier),
        exports,
        { env, cwd: () => join(root, "apps", app) },
      );
      const config = exports.default;
      const port = devPort + (CI ? 1000 : 0);
      assert.equal(config.use.baseURL, `http://localhost:${port}`, app);
      const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer];
      const appServer = servers.at(-1);
      assert.equal(
        appServer.port ?? new URL(appServer.url).port,
        appServer.port ? port : `${port}`,
      );
      assert.equal(appServer.command.includes(`run-e2e-dev.mjs ${port}`), !!CI, app);
      if (["tinyurl", "img", "scheduler"].includes(app)) {
        assert.equal(servers[0].url, `http://localhost:${CI ? 6173 : 5173}`);
        assert.equal(servers[0].command.includes("run-e2e-dev.mjs 6173"), !!CI);
      }
      if (app === "connpass") {
        assert.equal(new URL(servers[0].url).port, `${CI ? 6181 : 5181}`);
        assert.equal(servers[0].env.CONNPASS_E2E_IDP_PORT, `${CI ? 6181 : 5181}`);
      }
      if (app === "wiki") assert.equal(env.BASE_URL, config.use.baseURL);
      assert.ok(servers.every((server) => server.gracefulShutdown.signal === "SIGTERM"));
    }
  }
});

test("CI server keeps dev vars intact and restores E2E vars on success and failure", (t) => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "gdgjp-e2e-ports-")));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const devVars = [
    "RP_SESSION_SECRET=fixture-secret",
    "APP_URL=http://localhost:5174",
    "TINYURL_REDIRECT_URLS=http://localhost:5174/api/auth/callback/gdgjp",
    "OTHER_URL=https://example.com:5174",
    "",
  ].join("\n");
  writeFileSync(join(cwd, ".dev.vars"), devVars);
  writeFileSync(
    join(cwd, "wrangler.toml"),
    'name = "gdgjp-tinyurl"\n[[services]]\nbinding = "ACCOUNTS"\nservice = "gdgjp-accounts"\n',
  );
  mkdirSync(join(cwd, "build/server"), { recursive: true });
  writeFileSync(
    join(cwd, "build/server/wrangler.json"),
    JSON.stringify({
      name: "gdgjp-tinyurl",
      main: "index.js",
      assets: { directory: "../client" },
      services: [{ binding: "ACCOUNTS", service: "gdgjp-accounts" }],
    }),
  );
  writeFileSync(
    join(cwd, "pnpm"),
    `#!${process.execPath}
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
const args = process.argv.slice(2);
const previewPath = args[args.indexOf("--config") + 1];
writeFileSync("observed.json", JSON.stringify({
  args,
  environment: process.env.CLOUDFLARE_ENV,
  vars: readFileSync(".dev.vars.e2e", "utf8"),
  config: readFileSync(process.env.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH, "utf8"),
  preview: args.includes("--config") ? {
    config: JSON.parse(readFileSync(previewPath, "utf8")),
    vars: readFileSync(join(dirname(previewPath), ".dev.vars"), "utf8"),
  } : undefined,
}));
process.exit(Number(process.env.FIXTURE_EXIT));
`,
    { mode: 0o700 },
  );
  for (const built of [false, true]) {
    for (const exitCode of [0, 1]) {
      if (exitCode) writeFileSync(join(cwd, ".dev.vars.e2e"), "previous-e2e-vars\n");
      else rmSync(join(cwd, ".dev.vars.e2e"), { force: true });
      const run = spawnSync(process.execPath, [join(root, "scripts/run-e2e-dev.mjs"), "6174"], {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${cwd}${delimiter}${process.env.PATH}`,
          CLOUDFLARE_ENV: "",
          WIKI_E2E_ISSUER: "http://localhost:6173",
          FIXTURE_EXIT: String(exitCode),
          GDG_E2E_BUILT: built ? ["unrelated", basename(cwd)].join(",") : "unrelated",
        },
      });
      assert.equal(run.status, exitCode, run.stderr);
      const observed = JSON.parse(readFileSync(join(cwd, "observed.json"), "utf8"));
      if (built) {
        assert.deepEqual(observed.args.slice(0, 3), ["exec", "wrangler", "dev"]);
        assert.ok(observed.args.includes("--local"));
        assert.equal(observed.preview.config.name, "gdgjp-tinyurl-e2e");
        assert.equal(observed.preview.config.main, join(cwd, "build/server/index.js"));
        assert.equal(observed.preview.config.assets.directory, join(cwd, "build/client"));
        assert.equal(observed.preview.config.services[0].service, "gdgjp-accounts-e2e");
        assert.equal(observed.preview.vars, observed.vars);
        assert.equal(
          existsSync(dirname(observed.args[observed.args.indexOf("--config") + 1])),
          false,
        );
      } else {
        assert.deepEqual(observed.args, ["dev", "--port", "6174", "--strictPort"]);
      }
      assert.equal(observed.environment, built ? undefined : "e2e");
      assert.match(observed.config, /service = "gdgjp-accounts-e2e"/);
      assert.match(observed.vars, /IDP_URL=http:\/\/localhost:6173/);
      assert.equal(existsSync(join(cwd, ".wrangler.e2e.toml")), false);
      assert.match(observed.vars, /RP_SESSION_SECRET=fixture-secret/);
      assert.match(observed.vars, /RP_SESSION_SECRET=gdgjp-e2e-session-secret/);
      assert.match(observed.vars, /ENVIRONMENT=development/);
      assert.match(observed.vars, /TINYURL_REDIRECT_URLS=http:\/\/localhost:6174\//);
      assert.match(observed.vars, /APP_URL=http:\/\/localhost:6174/);
      assert.match(observed.vars, /ACCOUNTS_URL=http:\/\/localhost:6173/);
      assert.match(observed.vars, /OTHER_URL=https:\/\/example.com:5174/);
      assert.doesNotMatch(observed.vars, /localhost:51\d\d/);
      assert.equal(readFileSync(join(cwd, ".dev.vars"), "utf8"), devVars);
      if (exitCode) {
        assert.equal(readFileSync(join(cwd, ".dev.vars.e2e"), "utf8"), "previous-e2e-vars\n");
      } else {
        assert.equal(existsSync(join(cwd, ".dev.vars.e2e")), false);
      }
    }
  }
});
