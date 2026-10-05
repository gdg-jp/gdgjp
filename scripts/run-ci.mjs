import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, machine, release, tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { playwrightMetrics, playwrightReport, turboMetrics } from "./ci-metrics.mjs";

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
    "pnpm exec turbo test:e2e --filter=@gdgjp/accounts --filter=@gdgjp/tinyurl --filter=@gdgjp/img --filter=@gdgjp/scheduler --filter=@gdgjp/pay --filter=@gdgjp/design-system --filter=@gdgjp/wiki --filter=@gdgjp/ost --filter=@gdgjp/roster --filter=@gdgjp/connpass --concurrency=1 --output-logs=errors-only -- --reporter=dot,json",
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
  ["design-system", "@gdgjp/design-system"],
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
    return pkg.dependencies?.["@gdgjp/design-system"] === "workspace:*";
  }),
);

function expandUiGitlink(files) {
  if (!files.includes("design-system")) return files;
  const diff = spawnSync(
    "git",
    ["diff", "--cached", "--raw", "--abbrev=64", "--no-renames", "-z", "--", "design-system"],
    { encoding: "utf8" },
  );
  const match = diff.stdout?.match(/^:160000 160000 ([a-f0-9]+) ([a-f0-9]+) M\0/);
  if (diff.status !== 0 || !match) return files;
  const localNames = spawnSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" });
  if (localNames.status !== 0) return files;
  const env = { ...process.env };
  for (const name of localNames.stdout.trim().split("\n")) delete env[name];
  const changes = spawnSync(
    "git",
    ["-C", "design-system", "diff", "--name-only", "--no-renames", "-z", match[1], match[2], "--"],
    { encoding: "utf8", env },
  );
  if (changes.status !== 0) {
    console.warn("ci:warn UI commit history unavailable; validating the whole UI");
    return files;
  }
  // Compare the two committed gitlinks, never the submodule's unstaged changes.
  return [
    ...files.filter((file) => file !== "design-system"),
    ...changes.stdout
      .split("\0")
      .filter(Boolean)
      .map((file) => `design-system/${file}`),
  ];
}

export function changedFiles() {
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
      resolve(expandUiGitlink(files));
    });
  });
}

export function nodeEnvironment() {
  const config = spawnSync("git", ["config", "--local", "--get", "gdgjp.ciNode"], {
    encoding: "utf8",
  });
  if (config.error || ![0, 1].includes(config.status))
    throw new Error("Could not read gdgjp.ciNode");
  const node =
    process.env.GDG_CI_NODE || (config.status === 0 ? config.stdout.trim() : process.execPath);
  if (!isAbsolute(node) || !["node", "node.exe"].includes(basename(node))) {
    throw new Error("gdgjp.ciNode must be an absolute path to a Node executable named node");
  }
  const runtime =
    node === process.execPath
      ? { path: node, version: process.version, arch: process.arch }
      : JSON.parse(
          execFileSync(
            node,
            [
              "-p",
              "JSON.stringify({path:process.execPath,version:process.version,arch:process.arch})",
            ],
            { encoding: "utf8" },
          ),
        );
  const [major, minor] = runtime.version.replace(/^v/, "").split(".").map(Number);
  if (
    !Number.isInteger(major) ||
    major < 22 ||
    (major === 22 && minor < 18) ||
    realpathSync(node) !== realpathSync(runtime.path)
  ) {
    throw new Error("gdgjp.ciNode requires a real Node >=22.18 executable");
  }
  return {
    PATH: `${dirname(runtime.path)}${delimiter}${process.env.PATH ?? ""}`,
    GDG_CI_RUNTIME: `${process.platform}-${runtime.arch}-${release()}-${runtime.version}`,
  };
}

function isNodeFile(file) {
  return (
    file === "design-system" ||
    file.startsWith("design-system/") ||
    (!file.startsWith("cli/") &&
      (codeFilePattern.test(file) || nodeConfigurationFilePattern.test(file)))
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

export function changedSteps(mode, files) {
  // Agent configuration is intentionally versioned but is not application code.
  // Exclude it from the changed-file CI path used by the pre-commit hook.
  const relevantFiles = files.filter((file) => !preCommitExcludedPathPattern.test(file));
  const nodeFiles = relevantFiles.filter(isNodeFile);
  const uiFiles = nodeFiles.filter(
    (file) => file === "design-system" || file.startsWith("design-system/"),
  );
  const uiUnitTestsOnly =
    uiFiles.length > 0 &&
    uiFiles.every((file) => /^design-system\/src\/.*\.test\.tsx?$/.test(file));
  const uiE2ESpecsOnly =
    uiFiles.length > 0 &&
    uiFiles.every(
      (file) => /^design-system\/e2e\/.*\.spec\.[cm]?[jt]sx?$/.test(file) && existsSync(file),
    );
  const changedWorkspaces = new Set(
    nodeFiles
      .map((file) => workspaces.get(file.split("/")[0]))
      .filter((workspace) => workspace !== undefined),
  );
  const checksNodeScripts = relevantFiles.some((file) => nodeScriptInputPattern.test(file));
  const runtime = changedWorkspaces.size || checksNodeScripts ? nodeEnvironment() : undefined;
  const uiRuntime = uiFiles.length ? { ...runtime, CI: "true" } : undefined;
  const buildWorkspaces = new Set(
    nodeFiles
      .filter((file) => !testFilePattern.test(file))
      .map((file) => workspaces.get(file.split("/")[0]))
      .filter((workspace) => workspace !== undefined),
  );
  // Full UI validation is one Turbo graph: independent checks/builds overlap,
  // and browser tests wait for the library consumer and Storybook artifacts.
  if (mode === "full") buildWorkspaces.delete("@gdgjp/design-system");
  const steps = [];

  if (checksNodeScripts) {
    steps.push(["typecheck:node-scripts", "pnpm typecheck:node-scripts", runtime]);
  }

  if (
    relevantFiles.some((file) => !file.startsWith("design-system/") && biomeFilePattern.test(file))
  ) {
    // Biome owns staged-file selection, including deleted and ignored files.
    steps.push([
      "lint",
      "pnpm exec biome check --staged --files-ignore-unknown=true --no-errors-on-unmatched --reporter=github",
    ]);
  }
  const uiLintFiles = uiFiles.filter((file) => biomeFilePattern.test(file) && existsSync(file));
  if (uiLintFiles.length > 0) {
    // Parent `biome --staged` cannot see files inside a staged gitlink.
    steps.push([
      "lint:ui",
      `pnpm exec biome check ${uiLintFiles.map(shellQuote).join(" ")} --files-ignore-unknown=true --no-errors-on-unmatched --reporter=github`,
      uiRuntime,
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
    (workspace) => mode !== "full" || workspace !== "@gdgjp/design-system" || uiUnitTestsOnly,
  );
  if (typecheckWorkspaces.length > 0 && buildWorkspaces.size > 0) {
    // A single graph builds shared dependencies once, even without a cache.
    // Qualified tasks avoid building workspaces that only changed tests.
    const tasks = [
      ...typecheckWorkspaces.map((workspace) => `${workspace}#typecheck`),
      ...[...buildWorkspaces].map((workspace) => `${workspace}#build`),
    ];
    steps.push([
      "typecheck+build",
      `pnpm exec turbo ${tasks.map(shellQuote).join(" ")} --output-logs=errors-only`,
      tasks.every((task) => task.startsWith("@gdgjp/design-system#")) ? uiRuntime : runtime,
    ]);
  } else if (typecheckWorkspaces.length > 0) {
    const filters = typecheckWorkspaces.map((workspace) => ` --filter=${workspace}`).join("");
    steps.push([
      "typecheck",
      `pnpm exec turbo typecheck${filters} --output-logs=errors-only`,
      typecheckWorkspaces.length === 1 && typecheckWorkspaces[0] === "@gdgjp/design-system"
        ? uiRuntime
        : runtime,
    ]);
  }

  const scriptTests = relevantFiles.filter((file) =>
    /^\.github\/scripts\/.*\.test\.mjs$/.test(file),
  );
  if (
    relevantFiles.some((file) =>
      /^(?:scripts\/(?:run-ci|run-pre-commit-ci|ci-metrics)\.mjs|turbo\.json|package\.json)$/.test(
        file,
      ),
    )
  ) {
    for (const file of [
      ".github/scripts/gdg-ui-ci.test.mjs",
      ".github/scripts/ci-metrics.test.mjs",
      ".github/scripts/staged-ui.test.mjs",
    ]) {
      if (!scriptTests.includes(file)) scriptTests.push(file);
    }
  }
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
    if (workspace === "@gdgjp/design-system") {
      if (uiUnitTestsOnly) {
        steps.push([
          "test:ui",
          `pnpm --filter @gdgjp/design-system exec vitest related --run --reporter=minimal ${workspaceNodeFiles.map(shellQuote).join(" ")}`,
          uiRuntime,
        ]);
      } else if (mode !== "full") {
        steps.push([
          "test:ui",
          "pnpm exec turbo test --filter=@gdgjp/design-system --output-logs=errors-only",
          uiRuntime,
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

  if (buildWorkspaces.size > 0 && typecheckWorkspaces.length === 0) {
    const filters = [...buildWorkspaces].map((workspace) => ` --filter=${workspace}`).join("");
    steps.push(["build", `pnpm exec turbo build${filters} --output-logs=errors-only`, runtime]);
  }

  if (mode === "full") {
    if (changedWorkspaces.has("@gdgjp/design-system") && !uiUnitTestsOnly) {
      steps.push([
        "e2e:ui",
        "pnpm exec turbo typecheck test test:e2e:browser --filter=@gdgjp/design-system --output-logs=errors-only",
        // A cached browser result must never come from a stale dev server.
        {
          ...uiRuntime,
          GDG_UI_E2E_FILES: JSON.stringify(
            uiE2ESpecsOnly ? uiFiles.map((file) => file.slice("design-system/".length)) : [],
          ),
        },
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
      /^(?:wiki\/(?:tests\/e2e\/(?:global-setup|setup|run|fixtures|seed)\.|playwright\.config\.|vite\.config\.|package\.json)|pay\/(?:e2e\/|playwright\.config\.|vite\.config\.|package\.json))/.test(
        file,
      ),
    )) {
      e2eWorkspaces.set(workspace, null);
    }
    for (const [workspace, e2eFiles] of e2eWorkspaces) {
      if (workspace === "@gdgjp/design-system") continue;
      const directory = [...workspaces].find(([, name]) => name === workspace)?.[0];
      // A frontend edit does not create a browser suite. Only schedule apps
      // with a configured runner, rather than collecting their unit tests.
      if (!directory || !existsSync(`${directory}/playwright.config.ts`)) continue;
      const e2eArguments = e2eFiles ? ` ${e2eFiles.map(shellQuote).join(" ")}` : "";
      const command =
        workspace === "@gdgjp/wiki"
          ? `pnpm --filter ${workspace} test:e2e --reporter=dot,json${e2eArguments}`
          : `pnpm --filter ${workspace} exec playwright test --reporter=dot,json${e2eArguments}`;
      steps.push([`e2e:${workspace}`, command, runtime]);
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

export function runStep(
  [name, command, environment = {}],
  { noCache = false, cacheDirectory } = {},
) {
  // --no-cache alone still READS Turbo's cache. Disable both reads and writes.
  command = command.replaceAll(
    "pnpm exec turbo ",
    `pnpm exec turbo run --summarize=true${noCache ? " --cache=local:,remote:" : ""} `,
  );
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const startedAtUnixMs = Date.now();
    const output = [];
    const child = spawn(command, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GDG_CI_RUNTIME: `${process.platform}-${process.arch}-${release()}-${process.version}`,
        PLAYWRIGHT_JSON_OUTPUT_NAME: playwrightReport,
        ...(cacheDirectory
          ? {
              GOCACHE: join(cacheDirectory, "go"),
              PWTEST_CACHE_DIR: join(cacheDirectory, "playwright"),
            }
          : {}),
        ...environment,
      },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => output.push(chunk));
    child.on("error", (error) => output.push(Buffer.from(`${error.message}\n`)));
    child.on("close", (code, signal) => {
      const durationMs = performance.now() - startedAt;
      const duration = formatDuration(durationMs);
      const metric = {
        name,
        command,
        startedAtUnixMs,
        durationMs,
        exitCode: code,
        signal,
        runtime:
          environment.GDG_CI_RUNTIME ??
          `${process.platform}-${process.arch}-${release()}-${process.version}`,
      };
      try {
        metric.turboRuns = turboMetrics(Buffer.concat(output).toString());
        if (name.startsWith("e2e")) {
          const directories =
            name === "e2e"
              ? [...workspaces.keys()]
              : [name === "e2e:ui" ? "design-system" : name.replace(/^e2e:(?:@gdgjp\/)?/, "")];
          metric.playwright = directories.flatMap((directory) => {
            const cached = metric.turboRuns.some((run) =>
              run.tasks.some(
                (task) =>
                  task.taskId.startsWith(`@gdgjp/${directory}#test:e2e`) && task.cache === "HIT",
              ),
            );
            const report = playwrightMetrics(directory, startedAtUnixMs, cached);
            return report ? [report] : [];
          });
        }
      } catch (error) {
        metric.metricsError = error.message;
        console.warn(`ci:warn ${name} metrics: ${error.message}`);
      }
      if (code === 0) {
        console.log(`ci:pass ${name} duration=${duration}`);
        resolve(metric);
        return;
      }

      console.error(
        `ci:fail ${name} duration=${duration} exit=${code ?? "unknown"} signal=${signal ?? "none"}`,
      );
      process.stderr.write(Buffer.concat(output).toString());
      resolve(metric);
    });
    console.log(`ci:start ${name}`);
  });
}

export async function run(args = process.argv.slice(2)) {
  const startedAt = performance.now();
  const startedAtUnixMs = Date.now();
  const [mode, ...options] = args;
  const allSteps =
    mode === "go"
      ? goSteps
      : mode === "quick"
        ? quickSteps
        : mode === "full"
          ? fullSteps
          : undefined;
  const changedOnly = options.includes("--changed");
  const noCache = options.includes("--no-cache");
  const metricsPath = resolve(
    options.find((option) => option.startsWith("--metrics="))?.slice(10) ||
      `.turbo/ci-metrics/${startedAtUnixMs}-${process.pid}.json`,
  );

  if (
    !allSteps ||
    options.some(
      (option) =>
        option !== "--changed" && option !== "--no-cache" && !/^--metrics=.+/.test(option),
    )
  ) {
    console.error(
      "Usage: node scripts/run-ci.mjs <go|quick|full> [--changed] [--no-cache] [--metrics=path]",
    );
    process.exitCode = 2;
  } else {
    const files = changedOnly ? await changedFiles() : undefined;
    let steps = [];
    const metrics = [];
    let cacheDirectory;
    let error;
    if (changedOnly && !files) {
      console.warn("ci:warn could not inspect changed files; running all checks");
    }
    try {
      steps = changedOnly && files ? changedSteps(mode, files) : allSteps;
      if (changedOnly && steps.length === 0) console.log("ci:skip no relevant code changes");
      cacheDirectory = noCache && steps.length ? mkdtempSync(join(tmpdir(), "gdg-ci-")) : undefined;
      for (const step of steps) {
        const metric = await runStep(step, { noCache, cacheDirectory });
        metrics.push(metric);
        if (metric.exitCode !== 0) {
          process.exitCode = 1;
          break;
        }
      }
    } catch (cause) {
      error = cause.message;
      process.exitCode = 1;
      console.error(`ci:fail ${error}`);
    } finally {
      if (cacheDirectory) rmSync(cacheDirectory, { recursive: true, force: true });
    }
    const durationMs = performance.now() - startedAt;
    mkdirSync(dirname(metricsPath), { recursive: true });
    writeFileSync(
      metricsPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          mode,
          changedOnly,
          files,
          cache: noCache ? "disabled" : "default",
          startedAtUnixMs,
          durationMs,
          exitCode: process.exitCode ?? 0,
          error,
          runtime: {
            node: process.version,
            arch: process.arch,
            machine: machine(),
            platform: process.platform,
            cpus: availableParallelism(),
          },
          steps: metrics,
          skippedSteps: steps.slice(metrics.length).map(([name]) => name),
          turboRuns: metrics.flatMap((metric) => metric.turboRuns ?? []),
        },
        null,
        2,
      )}\n`,
    );
    console.log(`ci:total duration=${formatDuration(durationMs)} metrics=${metricsPath}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
