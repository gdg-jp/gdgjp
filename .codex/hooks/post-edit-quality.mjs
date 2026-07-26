import { execFileSync } from "node:child_process";

function run(command, args) {
  try {
    execFileSync(command, args, {
      cwd: process.cwd(),
      stdio: "ignore",
    });
  } catch {
    // Post-edit checks are deliberately best-effort. Pre-commit CI reports failures.
  }
}

function changedFiles() {
  try {
    return execFileSync("git", ["status", "--porcelain=v1", "-z"], {
      cwd: process.cwd(),
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean)
      .map((entry) => entry.slice(3))
      .filter((file) => !file.includes(" -> "));
  } catch {
    return [];
  }
}

const files = changedFiles();
const biomeFiles = files.filter((file) =>
  /\.(?:[cm]?[jt]sx?|jsonc?|css|graphql|ya?ml)$/.test(file),
);
const goFiles = files.filter((file) => file.endsWith(".go"));

if (biomeFiles.length > 0) {
  run("pnpm", ["exec", "biome", "format", "--write", ...biomeFiles]);
  run("pnpm", ["exec", "biome", "lint", ...biomeFiles]);
}

if (goFiles.length > 0) {
  run("gofmt", ["-w", ...goFiles]);
}
