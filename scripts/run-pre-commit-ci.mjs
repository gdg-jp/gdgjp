import { execFileSync, spawnSync } from "node:child_process";

const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const result = spawnSync("pnpm", ["ci:full"], {
  cwd: repositoryRoot,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
