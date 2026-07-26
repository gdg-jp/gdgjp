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

const mode = process.argv[2];
const steps =
  mode === "go" ? goSteps : mode === "quick" ? quickSteps : mode === "full" ? fullSteps : undefined;

if (!steps) {
  console.error("Usage: node scripts/run-ci.mjs <go|quick|full>");
  process.exitCode = 2;
} else {
  for (const step of steps) {
    if (!(await runStep(step))) {
      process.exitCode = 1;
      break;
    }
  }
}
