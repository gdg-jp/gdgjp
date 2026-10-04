import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { release } from "node:os";
import { fileURLToPath } from "node:url";
import { compilerEnvironment } from "../ui/scripts/typescript.mjs";

const quickSteps = [
  ["typecheck:node-scripts", "pnpm typecheck:node-scripts"],
  ["lint", "pnpm exec biome check . --reporter=github"],
  ["ui-conventions", "node scripts/check-ui-conventions.mjs"],
  ["typecheck", "pnpm exec turbo typecheck --output-logs=errors-only"],
  [
    "test",
    "node --test --test-reporter=dot .github/scripts/*.test.mjs && pnpm exec turbo test --output-logs=errors-only -- --reporter=minimal",
  ],
  ["build", "pnpm exec turbo build --output-logs=errors-only"],
  [
    "go",
    // Match release targets in .github/workflows/deploy.yml so host-only builds
    // cannot hide GOOS/GOARCH breakage (for example Windows syscall gaps).
    'pnpm build:acl && cd cli && unformatted=$(gofmt -l .) && if [ -n "$unformatted" ]; then printf \'Files requiring gofmt:\\n%s\\n\' "$unformatted" >&2; exit 1; fi && go vet ./... && go test ./... && go build ./... && for target in darwin/amd64 darwin/arm64 linux/amd64 linux/arm64 windows/amd64 windows/arm64; do GOOS="${target%/*}" GOARCH="${target#*/}" go build -o /dev/null ./cmd/gdg || exit 1; done',
  ],
];

const goSteps = quickSteps.filter(([name]) => name === "go");

const fullSteps = [
  ...quickSteps,
  [
    "e2e",
    "pnpm exec turbo test:e2e --filter=@gdgjp/accounts --filter=@gdgjp/tinyurl --filter=@gdgjp/img --filter=@gdgjp/scheduler --filter=@gdgjp/ui --filter=@gdgjp/wiki --filter=@gdgjp/ost --filter=@gdgjp/roster --filter=@gdgjp/connpass --concurrency=1 --output-logs=errors-only -- --reporter=dot",
  ],
];

const codeFilePattern = /\.(?:[cm]?[jt]sx?|sql)$/;
const testFilePattern = /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|\/(?:e2e|__tests__)\/)/;
const biomeFilePattern = /\.(?:[cm]?[jt]sx?|jsonc?|css|graphql|ya?ml)$/;
const preCommitExcludedPathPattern = /^(?:\.agents|\.claude)\//;
const nodeScriptInputPattern =
  /^(?:\.codex\/hooks\/.*\.ts|cli\/internal\/wiki\/hooks\/.*\.ts|gdg-lib\/src\/acl\/|tsconfig\.node-scripts\.json)$/;
const nodeConfigurationFilePattern =
  /(?:^|\/)(?:package\.json|tsconfig(?:\.[^/]+)?\.json|vite\.config\.[cm]?[jt]s|wrangler\.(?:toml|jsonc?)|react-router\.config\.[cm]?[jt]s)$/;
const workspaces = new Map([
  ["accounts", "@gdgjp/accounts"],
  ["accounts-oidc-client-demo", "@gdgjp/accounts-oidc-client-demo"],
  ["agents", "@gdgjp/agents"],
  ["agents-index", "@gdgjp/agents-index"],
  ["gdg-lib", "@gdgjp/gdg-lib"],
  ["ui", "@gdgjp/ui"],
  ["go-extension", "@gdgjp/go-extension"],
  ["img", "@gdgjp/img"],
  ["ost", "@gdgjp/ost"],
  ["pay", "@gdgjp/pay"],
  ["roster", "@gdgjp/roster"],
  ["scheduler", "@gdgjp/scheduler"],
  ["sns", "@gdgjp/sns"],
  ["tinyurl", "@gdgjp/tinyurl"],
  ["tinyurl-gateway", "@gdgjp/tinyurl-gateway"],
  ["website", "@gdgjp/website"],
  ["wiki", "@gdgjp/wiki"],
  ["connpass", "@gdgjp/connpass"],
]);

const uiAppDirectories = new Set(
  readdirSync(process.cwd()).filter((directory) => {
    const packagePath = `${directory}/package.json`;
    if (!existsSync(packagePath)) return false;
    const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
    return pkg.dependencies?.["@gdgjp/ui"] === "workspace:*";
  }),
);

function changedFiles() {
  // A pre-commit hook must inspect the index, not the whole working tree. A
  // developer may have unrelated edits in progress while committing only a
  // subset of files; `git status` would make those edits run extra CI steps.
  const result = spawn("git", ["diff", "--cached", "--name-only", "-z", "--no-renames"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "ignore"],
  });
  const output = [];

  return new Promise((resolve) => {
    result.stdout.on("data", (chunk) => output.push(chunk));
    result.on("error", () => resolve(undefined));
    result.on("close", (code) => {
      if (code !== 0) {
        resolve(undefined);
        return;
      }

      const entries = Buffer.concat(output).toString().split("\0");
      const files = [];
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (!entry) {
          continue;
        }

        files.push(entry);
      }
      resolve(files);
    });
  });
}

function isNodeFile(file) {
  return (
    file === "ui" ||
    (!file.startsWith("cli/") &&
      (codeFilePattern.test(file) ||
        nodeConfigurationFilePattern.test(file) ||
        (file.startsWith("ui/") && /\.(?:css|mdx|woff2)$/.test(file))))
  );
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function workspaceFiles(files, predicate) {
  const filesByWorkspace = new Map();

  for (const file of files) {
    const [directory, ...relativePath] = file.split("/");
    const workspace = workspaces.get(directory);
    if (!workspace || !predicate(file)) {
      continue;
    }

    const existing = filesByWorkspace.get(workspace) ?? [];
    existing.push(relativePath.join("/"));
    filesByWorkspace.set(workspace, existing);
  }

  return filesByWorkspace;
}

function uiEnvironment() {
  const result = spawnSync("git", ["config", "--local", "--get", "gdgjp.typescriptNode"], {
    encoding: "utf8",
  });
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error("Could not read gdgjp.typescriptNode from the repository configuration.");
  }
  return {
    CI: "true",
    ...compilerEnvironment(result.status === 0 ? result.stdout.trim() : process.execPath),
  };
}

export function changedSteps(mode, files) {
  // Agent configuration is intentionally versioned but is not application code.
  // Exclude it from the changed-file CI path used by the pre-commit hook.
  const relevantFiles = files.filter((file) => !preCommitExcludedPathPattern.test(file));
  const nodeFiles = relevantFiles.filter(isNodeFile);
  const changedWorkspaces = new Set(
    nodeFiles
      .map((file) => workspaces.get(file.split("/")[0]))
      .filter((workspace) => workspace !== undefined),
  );
  const buildWorkspaces = new Set(
    nodeFiles
      .filter((file) => !testFilePattern.test(file))
      .map((file) => workspaces.get(file.split("/")[0]))
      .filter((workspace) => workspace !== undefined),
  );
  // Full UI validation is one Turbo graph: independent checks/builds overlap,
  // and browser tests wait for the library consumer and Storybook artifacts.
  if (mode === "full") buildWorkspaces.delete("@gdgjp/ui");
  const steps = [];

  if (relevantFiles.some((file) => nodeScriptInputPattern.test(file))) {
    steps.push(["typecheck:node-scripts", "pnpm typecheck:node-scripts"]);
  }

  if (relevantFiles.some((file) => biomeFilePattern.test(file))) {
    // Biome owns staged-file selection, including deleted and ignored files.
    steps.push([
      "lint",
      "pnpm exec biome check --staged --files-ignore-unknown=true --no-errors-on-unmatched --reporter=github",
    ]);
  }

  const changedUiApps = [...new Set(relevantFiles.map((file) => file.split("/")[0]))].filter(
    (directory) =>
      uiAppDirectories.has(directory) &&
      relevantFiles.some((file) => file.startsWith(`${directory}/app/`)),
  );
  for (const app of changedUiApps) {
    steps.push([
      `ui-conventions:${app}`,
      `node scripts/check-ui-conventions.mjs --app ${shellQuote(app)} --staged`,
    ]);
    steps.push([
      `locale-keys:${app}`,
      `node scripts/check-locale-keys.mjs --app ${shellQuote(app)}`,
    ]);
  }

  const typecheckWorkspaces = [...changedWorkspaces].filter(
    (workspace) => mode !== "full" || workspace !== "@gdgjp/ui",
  );
  if (typecheckWorkspaces.length > 0) {
    const filters = typecheckWorkspaces.map((workspace) => ` --filter=${workspace}`).join("");
    steps.push(["typecheck", `pnpm exec turbo typecheck${filters} --output-logs=errors-only`]);
  }

  const scriptTests = relevantFiles.filter((file) =>
    /^\.github\/scripts\/.*\.test\.mjs$/.test(file),
  );
  if (scriptTests.length > 0) {
    steps.push([
      "test:scripts",
      `node --test --test-reporter=dot ${scriptTests.map(shellQuote).join(" ")}`,
    ]);
  }

  const unitTestsByWorkspace = workspaceFiles(
    relevantFiles,
    (file) => isNodeFile(file) && !file.includes("/e2e/"),
  );
  for (const [workspace, workspaceNodeFiles] of unitTestsByWorkspace) {
    if (workspace === "@gdgjp/ui") {
      if (mode !== "full") {
        steps.push([
          "test:ui",
          "pnpm exec turbo test --filter=@gdgjp/ui --output-logs=errors-only",
        ]);
      }
      continue;
    }
    // Staged paths select checks; Vitest resolves their imports against the
    // current working tree, like the other local checks.
    steps.push([
      `test:${workspace}`,
      `pnpm --filter ${workspace} exec vitest related --run --reporter=minimal ${workspaceNodeFiles.map(shellQuote).join(" ")}`,
    ]);
  }

  if (buildWorkspaces.size > 0) {
    const filters = [...buildWorkspaces].map((workspace) => ` --filter=${workspace}`).join("");
    steps.push(["build", `pnpm exec turbo build${filters} --output-logs=errors-only`]);
  }

  if (mode === "full") {
    if (changedWorkspaces.has("@gdgjp/ui")) {
      steps.push([
        "e2e:ui",
        "pnpm exec turbo typecheck test test:e2e:browser --filter=@gdgjp/ui --output-logs=errors-only",
        // A cached browser result must never come from a stale dev server.
        uiEnvironment(),
      ]);
    }
    const e2eWorkspaces = new Map();
    for (const [workspace, files] of workspaceFiles(relevantFiles, (file) =>
      /(?:^|\/)(?:e2e|tests\/e2e)\/.*\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file),
    )) {
      e2eWorkspaces.set(workspace, files);
    }
    for (const [workspace] of workspaceFiles(
      relevantFiles,
      (file) => /^[^/]+\/app\//.test(file) && !testFilePattern.test(file),
    )) {
      e2eWorkspaces.set(workspace, null);
    }
    for (const [workspace] of workspaceFiles(relevantFiles, (file) =>
      /^wiki\/(?:tests\/e2e\/(?:global-setup|setup|run|fixtures|seed)\.|playwright\.config\.|vite\.config\.|package\.json)/.test(
        file,
      ),
    )) {
      e2eWorkspaces.set(workspace, null);
    }
    for (const [workspace, e2eFiles] of e2eWorkspaces) {
      if (workspace === "@gdgjp/ui") continue;
      const directory = [...workspaces].find(([, name]) => name === workspace)?.[0];
      // A frontend edit does not create a browser suite. Only schedule apps
      // with a configured runner, rather than collecting their unit tests.
      if (!directory || !existsSync(`${directory}/playwright.config.ts`)) continue;
      const e2eArguments = e2eFiles ? ` -- ${e2eFiles.map(shellQuote).join(" ")}` : "";
      const command =
        workspace === "@gdgjp/wiki"
          ? `pnpm --filter ${workspace} test:e2e${e2eArguments}`
          : `pnpm --filter ${workspace} exec playwright test --reporter=dot${e2eFiles ? ` ${e2eFiles.map(shellQuote).join(" ")}` : ""}`;
      steps.push([`e2e:${workspace}`, command]);
    }
  }

  if (
    relevantFiles.some(
      (file) =>
        (file.startsWith("cli/") &&
          (file.endsWith(".go") ||
            file.startsWith("cli/internal/wiki/hooks/") ||
            /\/go\.(?:mod|sum)$/.test(file))) ||
        file.startsWith("gdg-lib/src/acl/"),
    )
  ) {
    steps.push(...goSteps);
  }

  return steps;
}

function formatDuration(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function runStep([name, command, environment = {}]) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const output = [];
    const child = spawn(command, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GDG_CI_RUNTIME: `${process.platform}-${process.arch}-${release()}-${process.version}`,
        ...environment,
      },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => output.push(chunk));
    child.on("error", (error) => output.push(Buffer.from(`${error.message}\n`)));
    child.on("close", (code, signal) => {
      const duration = formatDuration(performance.now() - startedAt);
      if (code === 0) {
        console.log(`ci:pass ${name} duration=${duration}`);
        resolve(true);
        return;
      }

      console.error(`ci:fail ${name} exit=${code ?? "unknown"} signal=${signal ?? "none"}`);
      process.stderr.write(Buffer.concat(output).toString());
      resolve(false);
    });
    console.log(`ci:start ${name}`);
  });
}

export async function run(args = process.argv.slice(2)) {
  const startedAt = performance.now();
  const [mode, ...options] = args;
  const allSteps =
    mode === "go"
      ? goSteps
      : mode === "quick"
        ? quickSteps
        : mode === "full"
          ? fullSteps
          : undefined;
  const changedOnly = options.length === 1 && options[0] === "--changed";

  if (!allSteps || (options.length > 0 && !changedOnly)) {
    console.error("Usage: node scripts/run-ci.mjs <go|quick|full> [--changed]");
    process.exitCode = 2;
  } else {
    const files = changedOnly ? await changedFiles() : undefined;
    const steps = changedOnly && files ? changedSteps(mode, files) : allSteps;
    if (changedOnly && !files) {
      console.warn("ci:warn could not inspect changed files; running all checks");
    }
    if (changedOnly && steps.length === 0) {
      console.log("ci:skip no relevant code changes");
    }
    for (const step of steps) {
      if (!(await runStep(step))) {
        process.exitCode = 1;
        break;
      }
    }
    console.log(`ci:total duration=${formatDuration(performance.now() - startedAt)}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
