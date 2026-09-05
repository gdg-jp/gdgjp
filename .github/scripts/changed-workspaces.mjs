import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CI_WORKSPACES = [
  { directory: "accounts", workspace: "@gdgjp/accounts", build: true, e2e: true },
  { directory: "tinyurl", workspace: "@gdgjp/tinyurl", build: true, e2e: true },
  { directory: "wiki", workspace: "@gdgjp/wiki", build: true, e2e: false },
  { directory: "img", workspace: "@gdgjp/img", build: true, e2e: true },
  { directory: "scheduler", workspace: "@gdgjp/scheduler", build: true, e2e: true },
  { directory: "sns", workspace: "@gdgjp/sns", build: true, e2e: false },
  { directory: "connpass", workspace: "@gdgjp/connpass", build: true, e2e: false },
  { directory: "pay", workspace: "@gdgjp/pay", build: true, e2e: false },
  { directory: "ost", workspace: "@gdgjp/ost", build: true, e2e: false },
  { directory: "roster", workspace: "@gdgjp/roster", build: true, e2e: true },
  { directory: "website", workspace: "@gdgjp/website", build: true, e2e: false },
  { directory: "gdg-lib", workspace: "@gdgjp/gdg-lib", build: false, e2e: false },
  {
    directory: "tinyurl-gateway",
    workspace: "@gdgjp/tinyurl-gateway",
    build: true,
    e2e: false,
  },
  { directory: "agents", workspace: "@gdgjp/agents", build: true, e2e: false },
  { directory: "go-extension", workspace: "@gdgjp/go-extension", build: true, e2e: false },
  {
    directory: "agent-host/langfuse-forwarder",
    workspace: "@gdgjp/langfuse-forwarder",
    build: false,
    e2e: false,
  },
];

const DEPLOY_TARGETS = [
  {
    app: "accounts",
    workspace: "@gdgjp/accounts",
    provider: "cloudflare",
    migrate: true,
  },
  {
    app: "tinyurl",
    workspace: "@gdgjp/tinyurl",
    provider: "cloudflare",
    migrate: true,
  },
  { app: "wiki", workspace: "@gdgjp/wiki", provider: "cloudflare", migrate: true },
  { app: "img", workspace: "@gdgjp/img", provider: "cloudflare", migrate: true },
  {
    app: "scheduler",
    workspace: "@gdgjp/scheduler",
    provider: "cloudflare",
    migrate: true,
  },
  { app: "sns", workspace: "@gdgjp/sns", provider: "cloudflare", migrate: true },
  {
    app: "connpass",
    workspace: "@gdgjp/connpass",
    provider: "cloudflare",
    migrate: true,
  },
  {
    app: "pay",
    workspace: "@gdgjp/pay",
    provider: "cloudflare",
    migrate: true,
  },
  {
    app: "ost",
    workspace: "@gdgjp/ost",
    provider: "cloudflare",
    migrate: false,
  },
  {
    app: "roster",
    workspace: "@gdgjp/roster",
    provider: "cloudflare",
    migrate: true,
  },
  {
    app: "website",
    workspace: "@gdgjp/website",
    provider: "cloudflare",
    migrate: false,
  },
  {
    app: "tinyurl-gateway",
    workspace: "@gdgjp/tinyurl-gateway",
    provider: "vercel-gateway",
    migrate: false,
  },
  {
    app: "agents",
    workspace: "@gdgjp/agents",
    provider: "vercel-agents",
    migrate: false,
  },
];

const GDG_LIB_DEPENDENTS = new Set([
  "accounts",
  "tinyurl",
  "wiki",
  "img",
  "scheduler",
  "sns",
  "connpass",
  "pay",
  "website",
  "agents",
  "roster",
]);

const GLOBAL_INPUTS = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  "tsconfig.json",
  "biome.json",
  "biome.jsonc",
]);

const BIOME_FILE_PATTERN = /\.(?:[cm]?[jt]sx?|jsonc?|css|graphql|ya?ml)$/;
const OPENAPI_DIRECTORIES = new Set(["accounts", "img", "tinyurl", "wiki", "connpass", "sns"]);

function unique(values) {
  return [...new Set(values)];
}

function allResults() {
  return {
    ci: CI_WORKSPACES.map(({ workspace }) => workspace),
    build: CI_WORKSPACES.filter(({ build }) => build).map(({ workspace }) => workspace),
    e2e: CI_WORKSPACES.filter(({ e2e }) => e2e).map(({ directory }) => directory),
    deploy: DEPLOY_TARGETS,
    lint: true,
    openapi: true,
    scriptTests: true,
    cli: true,
    full: true,
  };
}

export function classifyChanges(files, { forceAll = false } = {}) {
  if (forceAll) {
    return allResults();
  }

  const normalizedFiles = unique(files.filter(Boolean).map((file) => file.replaceAll("\\", "/")));
  const ciGlobal = normalizedFiles.some(
    (file) =>
      GLOBAL_INPUTS.has(file) ||
      file === ".github/workflows/ci.yml" ||
      file.startsWith(".github/scripts/changed-workspaces."),
  );
  const deployGlobal = normalizedFiles.some(
    (file) =>
      GLOBAL_INPUTS.has(file) ||
      file === ".github/workflows/deploy.yml" ||
      file.startsWith(".github/scripts/changed-workspaces."),
  );

  const directDirectories = new Set(normalizedFiles.map((file) => file.split("/", 1)[0]));
  const affectedDirectories = new Set(directDirectories);
  if (directDirectories.has("gdg-lib")) {
    for (const directory of GDG_LIB_DEPENDENTS) {
      affectedDirectories.add(directory);
    }
  }

  const ciTargets = ciGlobal
    ? CI_WORKSPACES
    : CI_WORKSPACES.filter(
        ({ directory }) =>
          affectedDirectories.has(directory) ||
          normalizedFiles.some((file) => file === directory || file.startsWith(`${directory}/`)),
      );
  const deployTargets = deployGlobal
    ? DEPLOY_TARGETS
    : DEPLOY_TARGETS.filter(({ app }) => affectedDirectories.has(app));
  const openapi =
    ciGlobal ||
    normalizedFiles.some((file) => {
      const [directory, second] = file.split("/");
      return (
        (OPENAPI_DIRECTORIES.has(directory) &&
          (second === "openapi" || file === `${directory}/package.json`)) ||
        /^cli\/internal\/(?:accounts|wiki|connpass)\/(?:generate\.go|oapi-codegen\.yaml)$/.test(
          file,
        )
      );
    });

  return {
    ci: ciTargets.map(({ workspace }) => workspace),
    build: ciTargets.filter(({ build }) => build).map(({ workspace }) => workspace),
    e2e: ciTargets.filter(({ e2e }) => e2e).map(({ directory }) => directory),
    deploy: deployTargets,
    lint: normalizedFiles.some((file) => BIOME_FILE_PATTERN.test(file)),
    openapi,
    scriptTests: normalizedFiles.some(
      (file) =>
        /^\.github\/scripts\/.*\.mjs$/.test(file) ||
        /^agent-host\//.test(file) ||
        /^agents-index\//.test(file) ||
        /^cli\/internal\/wiki\/hooks\//.test(file) ||
        /^scripts\/install-gdg-agent-host\.sh$/.test(file),
    ),
    cli: ciGlobal || normalizedFiles.some((file) => file.startsWith("cli/")),
    full: false,
  };
}

function parseArguments(args) {
  const options = { forceAll: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--all") {
      options.forceAll = true;
    } else if (argument === "--base" || argument === "--head") {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`${argument} requires a value`);
      }
      options[argument.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function isUsableRevision(revision) {
  return (
    typeof revision === "string" &&
    !/^0+$/.test(revision) &&
    spawnSync("git", ["cat-file", "-e", `${revision}^{commit}`], { stdio: "ignore" }).status === 0
  );
}

function changedFiles(base, head) {
  const result = spawnSync("git", ["diff", "--name-only", "-z", "--no-renames", base, head], {
    encoding: "buffer",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.toString() || "git diff failed");
  }
  return result.stdout.toString().split("\0").filter(Boolean);
}

function workflowOutputs(result, base, head) {
  return {
    ci: JSON.stringify(result.ci),
    build: JSON.stringify(result.build),
    e2e: JSON.stringify(result.e2e),
    deploy: JSON.stringify(result.deploy),
    "deploy-apps": JSON.stringify(result.deploy.map(({ app }) => app)),
    lint: String(result.lint),
    openapi: String(result.openapi),
    "script-tests": String(result.scriptTests),
    cli: String(result.cli),
    full: String(result.full),
    base: base ?? "",
    head: head ?? "",
  };
}

export function run(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  const useAll =
    options.forceAll || !isUsableRevision(options.base) || !isUsableRevision(options.head);
  const result = classifyChanges(useAll ? [] : changedFiles(options.base, options.head), {
    forceAll: useAll,
  });
  const outputs = workflowOutputs(result, options.base, options.head);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `${Object.entries(outputs)
        .map(([name, value]) => `${name}=${value}`)
        .join("\n")}\n`,
    );
  } else {
    process.stdout.write(`${JSON.stringify(outputs, null, 2)}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
