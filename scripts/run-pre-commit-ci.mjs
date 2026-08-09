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

const result = spawnSync("pnpm", ["ci:full", "--changed"], {
  cwd: repositoryRoot,
  env: environment,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
