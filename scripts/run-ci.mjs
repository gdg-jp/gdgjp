import { spawn } from "node:child_process";

const quickSteps = [
  ["lint", "pnpm exec biome check . --reporter=github"],
  ["typecheck", "pnpm exec turbo typecheck --output-logs=errors-only"],
  [
    "test",
    "node --test --test-reporter=dot .github/scripts/*.test.mjs && pnpm exec turbo test --output-logs=errors-only -- --reporter=minimal",
  ],
  ["build", "pnpm exec turbo build --output-logs=errors-only"],
  [
    "go",
    'cd cli && unformatted=$(gofmt -l .) && if [ -n "$unformatted" ]; then printf \'Files requiring gofmt:\\n%s\\n\' "$unformatted" >&2; exit 1; fi && go vet ./... && go test ./... && go build ./...',
  ],
];

const goSteps = quickSteps.filter(([name]) => name === "go");

const fullSteps = [
  ...quickSteps,
  [
    "e2e",
    "pnpm exec turbo test:e2e --filter=@gdgjp/accounts --filter=@gdgjp/tinyurl --filter=@gdgjp/img --filter=@gdgjp/scheduler --concurrency=1 --output-logs=errors-only -- --reporter=dot",
  ],
];

const codeFilePattern = /\.(?:[cm]?[jt]sx?|sql)$/;
const biomeFilePattern = /\.(?:[cm]?[jt]sx?|jsonc?|css|graphql|ya?ml)$/;
const preCommitExcludedPathPattern = /^(?:\.agents|\.claude)\//;
const nodeConfigurationFilePattern =
  /(?:^|\/)(?:package\.json|tsconfig(?:\.[^/]+)?\.json|vite\.config\.[cm]?[jt]s|wrangler\.(?:toml|jsonc?)|react-router\.config\.[cm]?[jt]s)$/;
const globalNodeInputs = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  "tsconfig.json",
  "biome.json",
  "biome.jsonc",
]);
const workspaces = new Map([
  ["accounts", "@gdgjp/accounts"],
  ["accounts-oidc-client-demo", "@gdgjp/accounts-oidc-client-demo"],
  ["gdg-lib", "@gdgjp/gdg-lib"],
  ["go-extension", "@gdgjp/go-extension"],
  ["img", "@gdgjp/img"],
  ["scheduler", "@gdgjp/scheduler"],
  ["sns", "@gdgjp/sns"],
  ["tinyurl", "@gdgjp/tinyurl"],
  ["tinyurl-gateway", "@gdgjp/tinyurl-gateway"],
  ["website", "@gdgjp/website"],
  ["wiki", "@gdgjp/wiki"],
]);

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
    !file.startsWith("cli/") &&
    (codeFilePattern.test(file) || nodeConfigurationFilePattern.test(file))
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

function changedSteps(mode, files) {
  // Agent configuration is intentionally versioned but is not application code.
  // Exclude it from the changed-file CI path used by the pre-commit hook.
  const relevantFiles = files.filter((file) => !preCommitExcludedPathPattern.test(file));
  const hasGlobalNodeInput = relevantFiles.some((file) => globalNodeInputs.has(file));
  const nodeFiles = relevantFiles.filter(isNodeFile);
  const changedWorkspaces = new Set(
    nodeFiles
      .map((file) => workspaces.get(file.split("/")[0]))
      .filter((workspace) => workspace !== undefined),
  );
  const steps = [];

  if (relevantFiles.some((file) => biomeFilePattern.test(file))) {
    // Biome owns staged-file selection, including deleted and ignored files.
    steps.push([
      "lint",
      "pnpm exec biome check --staged --files-ignore-unknown=true --no-errors-on-unmatched --reporter=github",
    ]);
  }

  if (nodeFiles.length > 0 || hasGlobalNodeInput) {
    const filters = hasGlobalNodeInput
      ? ""
      : [...changedWorkspaces].map((workspace) => ` --filter=${workspace}`).join("");
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
    // `related` receives staged source paths and uses Vitest's import graph to
    // select the tests that cover them. It deliberately does not inspect the
    // working tree, so unrelated unstaged edits cannot expand this check.
    steps.push([
      `test:${workspace}`,
      `pnpm --filter ${workspace} exec vitest related --run --reporter=minimal ${workspaceNodeFiles.map(shellQuote).join(" ")}`,
    ]);
  }

  if (nodeFiles.length > 0 || hasGlobalNodeInput) {
    const filters = hasGlobalNodeInput
      ? ""
      : [...changedWorkspaces].map((workspace) => ` --filter=${workspace}`).join("");
    steps.push(["build", `pnpm exec turbo build${filters} --output-logs=errors-only`]);
  }

  if (mode === "full") {
    const e2eTestsByWorkspace = workspaceFiles(relevantFiles, (file) =>
      /(?:^|\/)(?:e2e|tests\/e2e)\/.*\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file),
    );
    for (const [workspace, e2eFiles] of e2eTestsByWorkspace) {
      steps.push([
        `e2e:${workspace}`,
        `pnpm --filter ${workspace} exec playwright test --reporter=dot ${e2eFiles.map(shellQuote).join(" ")}`,
      ]);
    }
  }

  if (
    relevantFiles.some(
      (file) =>
        file.startsWith("cli/") && (file.endsWith(".go") || /\/go\.(?:mod|sum)$/.test(file)),
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
      env: { ...process.env, ...environment },
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

const [mode, ...options] = process.argv.slice(2);
const allSteps =
  mode === "go" ? goSteps : mode === "quick" ? quickSteps : mode === "full" ? fullSteps : undefined;
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
}
