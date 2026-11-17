import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDesignSourceFile } from "../../scripts/check-design-harness.mjs";

const CI_WORKSPACES = [
  {
    directory: "packages/design-system",
    workspace: "@gdgjp/design-system",
    build: true,
    e2e: true,
  },
  { directory: "apps/accounts", workspace: "@gdgjp/accounts", build: true, e2e: true },
  { directory: "apps/tinyurl", workspace: "@gdgjp/tinyurl", build: true, e2e: true },
  { directory: "apps/wiki", workspace: "@gdgjp/wiki", build: true, e2e: true },
  { directory: "apps/img", workspace: "@gdgjp/img", build: true, e2e: true },
  { directory: "apps/scheduler", workspace: "@gdgjp/scheduler", build: true, e2e: true },
  { directory: "apps/sns", workspace: "@gdgjp/sns", build: true, e2e: true },
  { directory: "apps/connpass", workspace: "@gdgjp/connpass", build: true, e2e: true },
  { directory: "apps/pay", workspace: "@gdgjp/pay", build: true, e2e: true },
  { directory: "apps/ost", workspace: "@gdgjp/ost", build: true, e2e: true },
  { directory: "apps/roster", workspace: "@gdgjp/roster", build: true, e2e: true },
  { directory: "apps/mc", workspace: "@gdgjp/mc", build: true, e2e: true },
  { directory: "apps/screen", workspace: "@gdgjp/screen", build: true, e2e: true },
  { directory: "apps/deck", workspace: "@gdgjp/deck", build: true, e2e: true },
  { directory: "apps/roulette", workspace: "@gdgjp/roulette", build: true, e2e: true },
  { directory: "apps/pr", workspace: "@gdgjp/pr", build: true, e2e: true },
  { directory: "apps/website", workspace: "@gdgjp/website", build: true, e2e: true },
  {
    directory: "apps/live-checkin",
    workspace: "@gdgjp/live-checkin",
    build: true,
    e2e: false,
  },
  { directory: "packages/gdg-lib", workspace: "@gdgjp/gdg-lib", build: false, e2e: false },
  {
    directory: "apps/tinyurl-gateway",
    workspace: "@gdgjp/tinyurl-gateway",
    build: true,
    e2e: false,
  },
  { directory: "apps/agent", workspace: "@gdgjp/agent", build: true, e2e: false },
  { directory: "apps/mcp", workspace: "@gdgjp/mcp", build: true, e2e: false },
  { directory: "apps/go-extension", workspace: "@gdgjp/go-extension", build: true, e2e: false },
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
    app: "mc",
    workspace: "@gdgjp/mc",
    provider: "cloudflare",
    migrate: true,
  },
  {
    app: "screen",
    workspace: "@gdgjp/screen",
    provider: "cloudflare",
    migrate: true,
  },
  {
    app: "deck",
    workspace: "@gdgjp/deck",
    provider: "cloudflare",
    migrate: true,
  },
  {
    app: "roulette",
    workspace: "@gdgjp/roulette",
    provider: "cloudflare",
    migrate: true,
  },
  {
    app: "pr",
    workspace: "@gdgjp/pr",
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
    app: "live-checkin",
    workspace: "@gdgjp/live-checkin",
    provider: "cloudflare",
    migrate: false,
  },
  {
    app: "tinyurl-gateway",
    workspace: "@gdgjp/tinyurl-gateway",
    provider: "vercel-gateway",
    migrate: false,
  },
  { app: "agent", workspace: "@gdgjp/agent", provider: "cloudflare", migrate: true },
  { app: "mcp", workspace: "@gdgjp/mcp", provider: "cloudflare", migrate: false },
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
  "roster",
  "mc",
  "screen",
  "deck",
  "roulette",
  "pr",
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
const E2E_HARNESS_INPUTS = new Set([
  "scripts/run-e2e-dev.mjs",
  "scripts/run-isolated-e2e.mjs",
  "scripts/verification/workspace-snapshot.mjs",
  "scripts/verification/serve-vite.mjs",
]);

export function isE2EHarnessInput(file) {
  return E2E_HARNESS_INPUTS.has(file);
}

const JOB_LIFECYCLE_PREFIXES = [
  ".agents/skills/verify-job-lifecycle/",
  "apps/wiki/app/features/jobs/",
  "apps/wiki/app/db/schema/",
  "apps/wiki/app/routes/api/runner/",
  "apps/wiki/tests/fixtures/",
  "apps/wiki/migrations/",
  "apps/cli/internal/wiki/runner/",
  "apps/cli/internal/pr/runner/",
];
const JOB_LIFECYCLE_FILES = new Set([
  "apps/wiki/app/features/spaces/test-db.ts",
  "apps/wiki/app/features/agent-api/runner-identity.server.ts",
  "apps/wiki/schema.sql",
  "apps/wiki/package.json",
  "apps/wiki/vitest.config.ts",
  "apps/wiki/tsconfig.json",
  "apps/cli/go.mod",
  "apps/cli/go.sum",
  "scripts/verification/workspace-snapshot.mjs",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "package.json",
  "tsconfig.base.json",
]);

export function isJobLifecycleInput(file) {
  return (
    JOB_LIFECYCLE_FILES.has(file) ||
    JOB_LIFECYCLE_PREFIXES.some((prefix) => file.startsWith(prefix))
  );
}

function unique(values) {
  return [...new Set(values)];
}

function workspaceDirectory(file) {
  const [group, name] = file.split("/");
  if ((group === "apps" || group === "packages") && name) return `${group}/${name}`;
  return group;
}

function workspaceName(directory) {
  return directory.split("/").pop();
}

function allResults() {
  return {
    ci: CI_WORKSPACES.map(({ workspace }) => workspace),
    build: CI_WORKSPACES.filter(({ build }) => build).map(({ workspace }) => workspace),
    e2e: CI_WORKSPACES.filter(({ e2e }) => e2e).map(({ directory }) => workspaceName(directory)),
    deploy: DEPLOY_TARGETS,
    lint: true,
    openapi: true,
    scriptTests: true,
    cli: true,
    designSource: true,
    engineering: true,
    jobLifecycle: true,
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
      file === ".github/scripts/run-affected.mjs" ||
      file.startsWith(".github/scripts/changed-workspaces."),
  );
  const deployGlobal = normalizedFiles.some(
    (file) =>
      GLOBAL_INPUTS.has(file) ||
      file === ".github/workflows/deploy.yml" ||
      file.startsWith(".github/scripts/changed-workspaces."),
  );

  const directDirectories = new Set(normalizedFiles.map(workspaceDirectory));
  const affectedDirectories = new Set(directDirectories);
  if (directDirectories.has("packages/gdg-lib")) {
    for (const directory of GDG_LIB_DEPENDENTS) {
      affectedDirectories.add(`apps/${directory}`);
    }
  }

  // pr bundles the Playbook (rules, templates, check scripts) from the skills submodule at build
  // time, so a skills update is a pr change.
  if (directDirectories.has("skills")) affectedDirectories.add("apps/pr");

  // A submodule update appears as the path itself, without changed source filenames.
  if (directDirectories.has("packages/design-system")) {
    for (const directory of [
      "accounts",
      "img",
      "pay",
      "scheduler",
      "tinyurl",
      "wiki",
      "roster",
      "mc",
      "screen",
      "deck",
      "roulette",
      "pr",
    ]) {
      affectedDirectories.add(`apps/${directory}`);
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
    : DEPLOY_TARGETS.filter(({ app }) => affectedDirectories.has(`apps/${app}`));
  const openapi =
    ciGlobal ||
    normalizedFiles.some((file) => {
      const [group, name, third] = file.split("/");
      return (
        (group === "apps" &&
          OPENAPI_DIRECTORIES.has(name) &&
          (third === "openapi" || file === `apps/${name}/package.json`)) ||
        /^apps\/cli\/internal\/(?:accounts|wiki|connpass)\/(?:generate\.go|oapi-codegen\.yaml)$/.test(
          file,
        )
      );
    });

  return {
    ci: ciTargets.map(({ workspace }) => workspace),
    build: ciTargets.filter(({ build }) => build).map(({ workspace }) => workspace),
    e2e: (normalizedFiles.some(isE2EHarnessInput) ? CI_WORKSPACES : ciTargets)
      .filter(({ e2e }) => e2e)
      .map(({ directory }) => workspaceName(directory)),
    deploy: deployTargets,
    lint: normalizedFiles.some((file) => BIOME_FILE_PATTERN.test(file)),
    openapi,
    scriptTests: normalizedFiles.some(
      (file) =>
        /^\.github\/scripts\/.*\.mjs$/.test(file) ||
        file === "scripts/check-ui-conventions.mjs" ||
        file === "scripts/check-design-harness.mjs" ||
        file === "scripts/pstack.mjs" ||
        file === "scripts/check-docs.mjs" ||
        file === "scripts/check-workspace-boundaries.mjs" ||
        file === "scripts/check-code-comments.mjs" ||
        file === "scripts/code-comment-exceptions.json" ||
        file === "scripts/engineering-health.mjs" ||
        file === "scripts/run-ci.mjs" ||
        file === "scripts/run-go-ci.mjs" ||
        isE2EHarnessInput(file) ||
        file === "apps/wiki/tests/e2e/setup.ts" ||
        /^apps\/pr\/(?:e2e\/(?:run\.mjs|global-setup\.ts|fonts\.ts)|(?:vite|playwright)\.config\.ts|package\.json)$/.test(
          file,
        ) ||
        file === "apps/wiki/tests/architecture/ui-conventions-baseline.json" ||
        file === ".github/scripts/shell-allowlist.txt" ||
        file.endsWith(".sh"),
    ),
    cli:
      ciGlobal ||
      normalizedFiles.some(
        (file) =>
          file.startsWith("apps/cli/") ||
          file.startsWith("packages/gdg-lib/src/acl/") ||
          file === "scripts/run-go-ci.mjs",
      ),
    designSource: normalizedFiles.some((file) => isDesignSourceFile(file)),
    jobLifecycle: ciGlobal || normalizedFiles.some(isJobLifecycleInput),
    engineering:
      ciGlobal ||
      normalizedFiles.some((file) =>
        /^(?:\.agents\/|\.claude\/|\.codex\/|\.cursor\/|scripts\/pstack\.mjs$|packages\/gdg-lib\/src\/acl\/|tsconfig\.node-scripts\.json$)/.test(
          file,
        ),
      ),
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
    engineering: String(result.engineering),
    "job-lifecycle": String(result.jobLifecycle),
    ci: JSON.stringify(result.ci),
    build: JSON.stringify(result.build),
    e2e: JSON.stringify(result.e2e),
    deploy: JSON.stringify(result.deploy),
    "deploy-apps": JSON.stringify(result.deploy.map(({ app }) => app)),
    lint: String(result.lint),
    openapi: String(result.openapi),
    "script-tests": String(result.scriptTests),
    cli: String(result.cli),
    "design-source": String(result.designSource),
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
