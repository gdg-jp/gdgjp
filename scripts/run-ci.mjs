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
const nodeConfigurationFilePattern =
  /(?:^|\/)(?:package\.json|tsconfig(?:\.[^/]+)?\.json|vite\.config\.[cm]?[jt]s|wrangler\.(?:toml|jsonc?)|react-router\.config\.[cm]?[jt]s)$/;
const e2ePackages = new Set(["accounts", "tinyurl", "img", "scheduler"]);
const globalNodeInputs = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  "tsconfig.json",
  "biome.json",
  "biome.jsonc",
]);

function changedFiles() {
  const result = spawn("git", ["status", "--porcelain=v1", "-z"], {
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

        files.push(entry.slice(3));
        if (entry[0] === "R" || entry[0] === "C" || entry[1] === "R" || entry[1] === "C") {
          index += 1;
          if (entries[index]) {
            files.push(entries[index]);
          }
        }
      }
      resolve(files);
    });
  });
}

function relevantSteps(steps, files) {
  const hasGlobalNodeInput = files.some((file) => globalNodeInputs.has(file));
  const hasNodeCode =
    hasGlobalNodeInput ||
    files.some(
      (file) =>
        !file.startsWith("cli/") &&
        (codeFilePattern.test(file) || nodeConfigurationFilePattern.test(file)),
    );
  const hasE2eCode =
    hasGlobalNodeInput ||
    files.some((file) => {
      const [workspace] = file.split("/");
      return (
        e2ePackages.has(workspace) &&
        (codeFilePattern.test(file) || nodeConfigurationFilePattern.test(file))
      );
    });

  return steps.filter(([name]) => {
    if (name === "lint") {
      return files.some((file) => biomeFilePattern.test(file));
    }
    if (name === "go") {
      return files.some(
        (file) =>
          file.startsWith("cli/") && (file.endsWith(".go") || /\/go\.(?:mod|sum)$/.test(file)),
      );
    }
    if (name === "e2e") {
      return hasE2eCode;
    }
    return hasNodeCode;
  });
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
  const steps = changedOnly && files ? relevantSteps(allSteps, files) : allSteps;
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
