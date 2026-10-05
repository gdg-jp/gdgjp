import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const fixtureEnv = { ...process.env };
for (const name of execFileSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" })
  .trim()
  .split("\n")) {
  delete fixtureEnv[name];
}

test("staged UI selection expands committed gitlinks, ignoring later and unstaged edits", () => {
  const root = mkdtempSync(join(tmpdir(), "gdg-staged-ui-"));
  const ui = join(root, "design-system");
  const git = (cwd, args) =>
    execFileSync("git", args, { cwd, env: fixtureEnv, encoding: "utf8" }).trim();
  const commit = (cwd) => {
    git(cwd, [
      "-c",
      "user.name=CI test",
      "-c",
      "user.email=ci@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ]);
    return git(cwd, ["rev-parse", "HEAD"]);
  };
  const read = (index) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { changedFiles } from ${JSON.stringify(new URL("../../scripts/run-ci.mjs", import.meta.url).href)}; console.log(JSON.stringify(await changedFiles()));`,
        ],
        { cwd: root, env: { ...fixtureEnv, GIT_INDEX_FILE: index }, encoding: "utf8" },
      ).trim(),
    );
  try {
    mkdirSync(join(ui, "src"), { recursive: true });
    git(root, ["init", "--quiet"]);
    git(ui, ["init", "--quiet"]);
    writeFileSync(join(ui, "src/value.ts"), "export const value = 1;\n");
    writeFileSync(join(ui, "src/value.test.ts"), "// original test\n");
    git(ui, ["add", "."]);
    const before = commit(ui);
    git(root, ["update-index", "--add", "--cacheinfo", "160000", before, "design-system"]);
    commit(root);
    writeFileSync(join(ui, "src/value.test.ts"), "// changed test\n");
    git(ui, ["add", "src/value.test.ts"]);
    const staged = commit(ui);
    git(root, ["update-index", "--cacheinfo", "160000", staged, "design-system"]);
    const index = join(root, "selected.index");
    copyFileSync(join(root, ".git/index"), index);
    // A newer submodule HEAD and working-tree edit must not widen the staged selection.
    writeFileSync(join(ui, "src/value.ts"), "export const value = 2;\n");
    git(ui, ["add", "src/value.ts"]);
    commit(ui);
    writeFileSync(join(ui, "src/value.ts"), "export const value = 3;\n");
    assert.deepEqual(read(index), ["design-system/src/value.test.ts"]);
    // Missing history must preserve full validation, never silently skip the UI.
    git(root, ["update-index", "--cacheinfo", "160000", "a".repeat(40), "design-system"]);
    assert.deepEqual(read(join(root, ".git/index")), ["design-system"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
