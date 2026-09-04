import { execFileSync, spawnSync } from "node:child_process";

const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const environment = { ...process.env };
const gitLocalEnvironmentNames = execFileSync("git", ["rev-parse", "--local-env-vars"], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);
for (const name of gitLocalEnvironmentNames) {
  delete environment[name];
}

// Spawn through a shell so Windows resolves pnpm to pnpm.CMD, which Node
// refuses to execute directly. scripts/run-ci.mjs spawns the same way.
const result = spawnSync("pnpm ci:full --changed", {
  cwd: repositoryRoot,
  env: environment,
  stdio: "inherit",
  shell: true,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
