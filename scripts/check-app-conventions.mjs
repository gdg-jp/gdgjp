import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import ts from "typescript";

const CONFIG_PATH = "scripts/app-conventions.json";
const SOURCE_PATTERN = /\.[cm]?[jt]sx?$/;
const TEST_PATTERN = /\.test\.[cm]?[jt]sx?$/;
const SPEC_PATTERN = /\.spec\.[cm]?[jt]sx?$/;
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "build",
  "dist",
  "coverage",
  "playwright-report",
  "test-results",
  "public",
]);
const SOURCE_ROOTS = ["app", "workers", "src"];
const LLM_PACKAGES =
  /^(?:ai|openai|@anthropic-ai\/.+|@ai-sdk\/.+|@google\/genai|@google\/generative-ai|@google-cloud\/vertexai|@langchain\/.+|langchain)$/;
const LLM_CONFIG_TEXT = /\b(?:GEMINI|OPENAI|ANTHROPIC|VERTEX|AI_GATEWAY)\w*/;
const LLM_SOURCE_TEXT =
  /generativelanguage\.googleapis|api\.openai\.com|api\.anthropic\.com|aiplatform\.googleapis|\benv\.AI\.run\(/;
const IMPORT_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

const read = (path) => readFileSync(path, "utf8");

function walk(directory, visit) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) walk(path, visit);
    } else if (entry.isFile()) {
      visit(path, entry.name);
    }
  }
}

function sourceFiles(directory) {
  const files = [];
  walk(directory, (path, name) => {
    if (SOURCE_PATTERN.test(name) && !name.endsWith(".d.ts")) files.push(path);
  });
  return files;
}

function submodules(root) {
  const file = join(root, ".gitmodules");
  return existsSync(file)
    ? [...read(file).matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)].map((match) => resolve(root, match[1]))
    : [];
}

function wranglerConfig(directory) {
  const toml = join(directory, "wrangler.toml");
  if (existsSync(toml)) return { file: "wrangler.toml", config: parseToml(read(toml)) };
  for (const name of ["wrangler.jsonc", "wrangler.json"]) {
    const path = join(directory, name);
    if (existsSync(path)) {
      const parsed = ts.parseConfigFileTextToJson(path, read(path));
      if (parsed.error) throw new Error(`${path}: cannot parse`);
      return { file: name, config: parsed.config };
    }
  }
  return undefined;
}

function devVars(directory) {
  const path = join(directory, ".dev.vars.example");
  if (!existsSync(path)) return undefined;
  const values = new Map();
  for (const line of read(path).split("\n")) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) values.set(match[1], match[2].replace(/^["']|["']$/g, ""));
  }
  return values;
}

function devPort(directory, pkg) {
  for (const name of ["vite.config.ts", "vite.config.mts", "vite.config.js"]) {
    const path = join(directory, name);
    if (!existsSync(path)) continue;
    const match = read(path).match(/\bserver\s*:\s*\{[\s\S]*?\bport\s*:\s*(\d+)/);
    if (match) return Number(match[1]);
  }
  const script = pkg.scripts?.dev ?? "";
  const match = script.match(/(?:--port[= ]|\s-p\s+)(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function localPort(url) {
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1"].includes(parsed.hostname) ? Number(parsed.port) : undefined;
  } catch {
    return undefined;
  }
}

function applications(root) {
  const excluded = submodules(root);
  const directory = join(root, "apps");
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    const manifest = join(path, "package.json");
    if (!entry.isDirectory() || excluded.includes(path) || !existsSync(manifest)) return [];
    const pkg = JSON.parse(read(manifest));
    return [
      {
        name: entry.name,
        path: `apps/${entry.name}`,
        directory: path,
        pkg,
        wrangler: wranglerConfig(path),
        devVars: devVars(path),
        port: devPort(path, pkg),
      },
    ];
  });
}

async function sqlite() {
  const emitWarning = process.emitWarning;
  process.emitWarning = (warning, ...rest) =>
    String(warning).includes("SQLite") ? undefined : emitWarning.call(process, warning, ...rest);
  try {
    return (await import("node:sqlite")).DatabaseSync;
  } finally {
    process.emitWarning = emitWarning;
  }
}

function normalizeSchema(text) {
  return text
    .split("\n")
    .filter((line, index, lines) => !lines.slice(0, index + 1).every((l) => /^--|^$/.test(l)))
    .join("\n")
    .replace(/^CREATE TABLE IF NOT EXISTS /gm, "CREATE TABLE ")
    .replace(/\n\/\* [^\n]*\*\/;$/gm, ";")
    .trim();
}

function migrationFiles(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function checkMigrations(app, DatabaseSync, report) {
  const migrations = join(app.directory, "migrations");
  if (!existsSync(migrations)) return;
  const files = migrationFiles(migrations);
  const numbers = new Map();
  for (const name of files) {
    const match = name.match(/^(\d{4})_[a-z0-9_]+\.sql$/);
    if (!match) {
      report(
        `migration-name:${app.path}/migrations/${name}`,
        `${app.path}/migrations/${name}: rename to NNNN_snake_case.sql with the next unused number; Wrangler applies migrations in file-name order.`,
      );
      continue;
    }
    if (numbers.has(match[1])) {
      report(
        `migration-number:${app.path}/migrations/${name}`,
        `${app.path}/migrations/${name}: number ${match[1]} is already used by ${numbers.get(match[1])}. Give a new migration the next unused number; never rename one that has been applied remotely, because Wrangler records applied migrations by file name.`,
      );
    }
    numbers.set(match[1], name);
  }
  const schema = join(app.directory, "schema.sql");
  const dumpScript = app.pkg.scripts?.["schema:dump"] ?? "";
  const scriptsComplete =
    existsSync(schema) &&
    dumpScript.includes("scripts/dump-schema.sh") &&
    ["migrate:local", "migrate:remote"].every((name) =>
      /wrangler d1 migrations apply .*&& pnpm schema:dump/.test(app.pkg.scripts?.[name] ?? ""),
    );
  if (!scriptsComplete) {
    report(
      `migration-scripts:${app.path}`,
      `${app.path}: an app with migrations/ needs a generated schema.sql and the scripts "schema:dump": "bash ../../scripts/dump-schema.sh", "migrate:local" and "migrate:remote" that run "wrangler d1 migrations apply <db> --local|--remote && pnpm schema:dump".`,
    );
  }
  if (!existsSync(schema)) return;
  const db = new DatabaseSync(":memory:");
  try {
    for (const name of files) {
      try {
        db.exec(read(join(migrations, name)));
      } catch (error) {
        report(
          `migration-sql:${app.path}/migrations/${name}`,
          `${app.path}/migrations/${name}: does not apply on SQLite after the earlier migrations (${error.message}). Fix the migration so a fresh database can be built from migrations/ alone.`,
        );
        return;
      }
    }
    const dumped = db
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
      )
      .all()
      .map((row) => `${row.sql};`)
      .join("\n");
    if (normalizeSchema(read(schema)) !== normalizeSchema(dumped)) {
      report(
        `schema-dump:${app.path}`,
        `${app.path}/schema.sql: differs from the schema that migrations/ produce. schema.sql is generated: put the change in a new migration, run \`pnpm --filter ${app.pkg.name} schema:dump\`, and commit both.`,
      );
    }
  } finally {
    db.close();
  }
}

function checkRelyingParty(app, accounts, report) {
  const vars = app.wrangler?.config?.vars ?? {};
  const clientId = vars.IDP_CLIENT_ID;
  if (app.name === "accounts" || typeof clientId !== "string") return;
  const accountVars = accounts?.wrangler?.config?.vars ?? {};
  const key = Object.keys(accountVars).find(
    (name) => name.endsWith("_CLIENT_ID") && accountVars[name] === clientId,
  );
  const sharedRp = Boolean(app.pkg.dependencies?.["@gdgjp/gdg-lib"]);
  if (!sharedRp && !key) return;
  const fix = (detail) => `${app.path}: relying party "${clientId}" ${detail}`;
  const required = sharedRp ? ["RP_SESSION_SECRET", "IDP_CLIENT_SECRET", "APP_URL"] : [];
  const missing = required.filter((name) => !app.devVars?.has(name));
  if (missing.length) {
    report(
      `rp-dev-vars:${app.path}`,
      fix(`needs ${missing.join(", ")} in .dev.vars.example so a fresh checkout can sign in.`),
    );
  }
  const exampleId = app.devVars?.get("IDP_CLIENT_ID");
  if (exampleId !== undefined && exampleId !== clientId) {
    report(
      `rp-client-id:${app.path}`,
      fix(`sets IDP_CLIENT_ID=${exampleId} in .dev.vars.example; use the wrangler value.`),
    );
  }
  if (!accounts) return;
  if (!key) {
    report(
      `rp-registration:${app.path}`,
      fix(
        `is not registered with Accounts. Add <APP>_CLIENT_ID = "${clientId}" and <APP>_REDIRECT_URLS to apps/accounts/wrangler.toml [vars], <APP>_CLIENT_ID, <APP>_CLIENT_SECRET and <APP>_REDIRECT_URLS to apps/accounts/.dev.vars.example, and a tuple to collectSpecs in apps/accounts/app/features/oauth/seed-clients.server.ts.`,
      ),
    );
    return;
  }
  const prefix = key.slice(0, -"_CLIENT_ID".length);
  const gaps = [];
  if (!(`${prefix}_REDIRECT_URLS` in accountVars))
    gaps.push(`${prefix}_REDIRECT_URLS in apps/accounts/wrangler.toml [vars]`);
  for (const name of ["CLIENT_ID", "CLIENT_SECRET", "REDIRECT_URLS"]) {
    if (!accounts.devVars?.has(`${prefix}_${name}`))
      gaps.push(`${prefix}_${name} in apps/accounts/.dev.vars.example`);
  }
  const seed = join(accounts.directory, "app/features/oauth/seed-clients.server.ts");
  if (existsSync(seed) && !read(seed).includes(`env.${prefix}_CLIENT_ID`))
    gaps.push(`an env.${prefix}_CLIENT_ID tuple in seed-clients.server.ts collectSpecs`);
  if (gaps.length) {
    report(`rp-registration:${app.path}`, fix(`is missing ${gaps.join("; ")}.`));
  }
  const redirect = accounts.devVars?.get(`${prefix}_REDIRECT_URLS`);
  const redirectPort = redirect && localPort(redirect.split(",")[0]);
  if (app.port && redirectPort && redirectPort !== app.port) {
    report(
      `rp-redirect-port:${app.path}`,
      fix(
        `listens on ${app.port}, but apps/accounts/.dev.vars.example ${prefix}_REDIRECT_URLS points at port ${redirectPort}. Use the app's dev server port.`,
      ),
    );
  }
}

function checkDevPorts(apps, report) {
  const owners = new Map();
  for (const app of apps) {
    if (!app.port) continue;
    const owner = owners.get(app.port);
    if (owner) {
      report(
        `dev-port-duplicate:${app.path}`,
        `${app.path}: dev port ${app.port} is already used by ${owner}. Pick an unused port and update vite.config, playwright.config, .dev.vars.example APP_URL and the Accounts redirect URL together.`,
      );
    }
    owners.set(app.port, app.path);
    const appUrl = app.devVars?.get("APP_URL");
    const port = appUrl && localPort(appUrl);
    if (port && port !== app.port) {
      report(
        `dev-port-app-url:${app.path}`,
        `${app.path}: .dev.vars.example APP_URL uses port ${port}, but the dev server listens on ${app.port}. Make them equal so cookies and OAuth redirects use the dev origin.`,
      );
    }
  }
}

function checkLlmFree(app, report) {
  const reasons = [];
  const config = app.wrangler?.config ?? {};
  if (config.ai) reasons.push(`declares an AI binding in ${app.wrangler.file}`);
  const dependencies = Object.keys({
    ...app.pkg.dependencies,
    ...app.pkg.devDependencies,
  }).filter((name) => LLM_PACKAGES.test(name));
  if (dependencies.length) reasons.push(`depends on ${dependencies.join(", ")}`);
  for (const file of [app.wrangler?.file, ".dev.vars.example"].filter(Boolean)) {
    const path = join(app.directory, file);
    const match = existsSync(path) && read(path).match(LLM_CONFIG_TEXT);
    if (match) reasons.push(`configures ${match[0]} in ${file}`);
  }
  for (const root of SOURCE_ROOTS) {
    for (const file of sourceFiles(join(app.directory, root))) {
      if (TEST_PATTERN.test(file)) continue;
      const text = read(file);
      const imported = [...text.matchAll(IMPORT_PATTERN)].find((match) =>
        LLM_PACKAGES.test(match[1]),
      );
      const called = text.match(LLM_SOURCE_TEXT);
      if (imported || called) {
        reasons.push(
          `${relative(app.directory, file)} ${imported ? `imports ${imported[1]}` : `calls ${called[0]}`}`,
        );
      }
    }
  }
  for (const reason of reasons) {
    report(
      `llm-free:${app.path}:${reason}`,
      `${app.path}: this Worker never calls a model, but it ${reason}. Send the work to the OCI runner as an agent job instead, or remove the app from llmFree in ${CONFIG_PATH} if that decision changed.`,
    );
  }
}

function checkCrons(app, report) {
  const crons = app.wrangler?.config?.triggers?.crons ?? [];
  const sources = SOURCE_ROOTS.flatMap((root) => sourceFiles(join(app.directory, root))).filter(
    (file) => !TEST_PATTERN.test(file),
  );
  const text = sources.map(read).join("\n");
  if (crons.length > 1) {
    for (const cron of crons) {
      if (!text.includes(`"${cron}"`)) {
        report(
          `cron-unhandled:${app.path}:${cron}`,
          `${app.path}: ${app.wrangler.file} schedules "${cron}", but no source names it. With several crons the scheduled handler must branch on each one; export a *_CRON constant for it and dispatch on controller.cron.`,
        );
      }
    }
  }
  for (const match of text.matchAll(/\b[A-Z][A-Z0-9_]*_CRON\s*=\s*"([^"]+)"/g)) {
    if (!crons.includes(match[1])) {
      report(
        `cron-unscheduled:${app.path}:${match[1]}`,
        `${app.path}: source defines cron "${match[1]}", but ${app.wrangler?.file ?? "wrangler.toml"} [triggers].crons does not schedule it. Add it to the triggers or delete the dead branch.`,
      );
    }
  }
}

function subjectExists(name, siblings) {
  const prefix = name.replace(TEST_PATTERN, "");
  return siblings
    .filter((sibling) => SOURCE_PATTERN.test(sibling) && !TEST_PATTERN.test(sibling))
    .map((sibling) => sibling.replace(SOURCE_PATTERN, ""))
    .some((candidate) => prefix === candidate || prefix.startsWith(`${candidate}.`));
}

function checkTestPlacement(root, workspace, report) {
  for (const sourceRoot of SOURCE_ROOTS) {
    walk(join(workspace, sourceRoot), (path, name) => {
      const file = relative(root, path).split(sep).join("/");
      if (SPEC_PATTERN.test(name)) {
        report(
          `spec-placement:${file}`,
          `${file}: Playwright specs live in the workspace's e2e/ (or tests/e2e/) directory; move it there. Vitest tests use *.test.ts beside their subject.`,
        );
      }
      if (!TEST_PATTERN.test(name) || /(?:^|\.)architecture\.test\./.test(name)) return;
      const siblings = readdirSync(join(path, ".."));
      if (!subjectExists(name, siblings)) {
        report(
          `test-colocation:${file}`,
          `${file}: name a sibling subject: <subject>.test.ts or <subject>.<aspect>.test.ts next to the module it covers. Move a test that spans a subsystem under tests/.`,
        );
      }
    });
  }
}

function isTestPath(file) {
  return TEST_PATTERN.test(file) || /(?:^|\/)(?:e2e|tests)\//.test(file);
}

function checkGdgLibRuntime(root, report) {
  const lib = join(root, "packages/gdg-lib/src");
  for (const path of sourceFiles(lib)) {
    const file = relative(root, path).split(sep).join("/");
    if (isTestPath(file) || file.startsWith("packages/gdg-lib/src/testing/")) continue;
    for (const match of read(path).matchAll(IMPORT_PATTERN)) {
      if (match[1].startsWith("node:")) {
        report(
          `gdg-lib-node:${file}:${match[1]}`,
          `${file}: imports ${match[1]}, but @gdgjp/gdg-lib runs inside Cloudflare Workers. Use Web APIs (crypto.subtle, fetch, TextEncoder) or move the helper under src/testing/ if only tests need it.`,
        );
      }
    }
  }
  const excluded = submodules(root);
  for (const group of ["apps", "packages"]) {
    walk(join(root, group), (path, name) => {
      if (!SOURCE_PATTERN.test(name) || excluded.some((dir) => path.startsWith(`${dir}${sep}`)))
        return;
      const file = relative(root, path).split(sep).join("/");
      if (isTestPath(file) || file.startsWith("packages/gdg-lib/src/testing/")) return;
      for (const match of read(path).matchAll(IMPORT_PATTERN)) {
        if (match[1].startsWith("@gdgjp/gdg-lib/testing")) {
          report(
            `gdg-lib-testing:${file}`,
            `${file}: imports ${match[1]}, a node:sqlite test fake. Only *.test.ts files and e2e/ or tests/ may use it; Worker code uses the real Durable Object storage.`,
          );
        }
      }
    });
  }
}

function checkBindingAccess(root, app, report) {
  for (const path of sourceFiles(join(app.directory, "app"))) {
    if (TEST_PATTERN.test(path)) continue;
    if (/import\s*\{[^}]*\benv\b[^}]*\}\s*from\s*["']cloudflare:workers["']/.test(read(path))) {
      const file = relative(root, path).split(sep).join("/");
      report(
        `binding-access:${file}`,
        `${file}: imports env from cloudflare:workers. Read bindings from context.cloudflare.env in the loader or action and pass what the feature needs as an argument.`,
      );
    }
  }
}

export async function checkAppConventions(root) {
  const configFile = join(root, CONFIG_PATH);
  const config = existsSync(configFile) ? JSON.parse(read(configFile)) : {};
  const llmFree = new Set(config.llmFree ?? []);
  const baseline = new Set(config.baseline ?? []);
  const errors = [];
  const seen = new Set();
  const report = (id, message) => {
    seen.add(id);
    if (!baseline.has(id)) errors.push(`${message} [${id}]`);
  };
  const DatabaseSync = await sqlite();
  const apps = applications(root);
  const accounts = apps.find((app) => app.name === "accounts");
  for (const app of apps) {
    checkMigrations(app, DatabaseSync, report);
    checkRelyingParty(app, accounts, report);
    checkCrons(app, report);
    checkTestPlacement(root, app.directory, report);
    checkBindingAccess(root, app, report);
    if (llmFree.has(app.path)) checkLlmFree(app, report);
  }
  for (const path of llmFree) {
    if (!apps.some((app) => app.path === path)) {
      errors.push(`${CONFIG_PATH}: llmFree lists ${path}, which is not an application.`);
    }
  }
  checkDevPorts(apps, report);
  checkTestPlacement(root, join(root, "packages/gdg-lib"), report);
  checkGdgLibRuntime(root, report);
  for (const id of baseline) {
    if (!seen.has(id)) {
      errors.push(
        `${CONFIG_PATH}: baseline entry "${id}" no longer matches a violation. Delete it so the baseline only shrinks.`,
      );
    }
  }
  return { errors, apps: apps.length, baselined: baseline.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--root")) {
      throw new Error("Usage: node scripts/check-app-conventions.mjs [--root DIRECTORY]");
    }
    const result = await checkAppConventions(resolve(args[1] ?? process.cwd()));
    if (result.errors.length) {
      console.error(result.errors.join("\n"));
      process.exitCode = 1;
    } else {
      console.log(
        `App conventions passed: ${result.apps} applications, ${result.baselined} baselined violations`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
