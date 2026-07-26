import { execFileSync } from "node:child_process";

try {
  const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();

  execFileSync("git", ["config", "--local", "core.hooksPath", ".githooks"], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
} catch {
  // Package installation can happen outside a Git checkout.
}
