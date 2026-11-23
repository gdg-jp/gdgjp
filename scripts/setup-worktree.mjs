import { execFileSync } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const secretFilePattern = /^(\.env|\.dev\.vars)(\..+)?$/;
const copiedDirectoryNames = new Set([".vercel"]);
const skippedPathPrefixes = [".claude/worktrees/", "local_data/"];

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function run(cwd, command, args) {
  console.log(`$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function findMainCheckout(worktree) {
  const commonDir = git(worktree, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return dirname(commonDir);
}

function listLocalOnlyEntries(mainCheckout) {
  const output = git(mainCheckout, [
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
    "-z",
  ]);
  return output
    .split("\0")
    .filter(Boolean)
    .filter((entry) => !skippedPathPrefixes.some((prefix) => entry.startsWith(prefix)))
    .filter((entry) => !entry.split("/").includes("build"))
    .filter((entry) => {
      const name = basename(entry.replace(/\/$/, ""));
      if (entry.endsWith("/")) return copiedDirectoryNames.has(name);
      return secretFilePattern.test(name) && !name.endsWith(".example");
    })
    .map((entry) => entry.replace(/\/$/, ""));
}

function copyLocalOnlyEntries(mainCheckout, worktree) {
  const entries = listLocalOnlyEntries(mainCheckout);
  let copied = 0;
  for (const entry of entries) {
    const target = join(worktree, entry);
    if (existsSync(target)) {
      console.log(`skip (exists): ${entry}`);
      continue;
    }
    cpSync(join(mainCheckout, entry), target, { recursive: true });
    console.log(`copied: ${entry}`);
    copied += 1;
  }
  console.log(`Copied ${copied} of ${entries.length} local-only entries from ${mainCheckout}`);
}

const worktree = resolve(git(process.cwd(), ["rev-parse", "--show-toplevel"]));
const mainCheckout = findMainCheckout(worktree);

if (mainCheckout === worktree) {
  console.log("Running in the main checkout; nothing to copy.");
} else {
  copyLocalOnlyEntries(mainCheckout, worktree);
}

run(worktree, "git", ["submodule", "update", "--init", "packages/design-system"]);
run(worktree, "pnpm", ["install", "--frozen-lockfile", "--prefer-offline"]);
