import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { classifyChanges } from "./changed-workspaces.mjs";

const workflow = parse(readFileSync(new URL("../workflows/ci.yml", import.meta.url), "utf8"));
const runner = fileURLToPath(new URL("./run-affected.mjs", import.meta.url));

function execute(task, workspaces, exitCode = 0) {
  const directory = mkdtempSync(join(tmpdir(), "gdg-affected-"));
  try {
    const output = join(directory, "arguments.json");
    const executable = join(directory, "pnpm");
    writeFileSync(
      executable,
      '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.CAPTURE, JSON.stringify(process.argv.slice(2))); process.exit(Number(process.env.CHILD_EXIT));\n',
    );
    chmodSync(executable, 0o755);
    const result = spawnSync(process.execPath, [runner, task], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH}`,
        WORKSPACES: JSON.stringify(workspaces),
        CAPTURE: output,
        CHILD_EXIT: String(exitCode),
      },
    });
    return {
      ...result,
      arguments: result.status === exitCode ? readFileSync(output, "utf8") : null,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("every affected workspace reaches hosted typecheck, test and build without another target list", () => {
  const targets = classifyChanges([], { forceAll: true }).ci;
  for (const task of ["typecheck", "test", "build"]) {
    const step = workflow.jobs[task].steps.find((item) =>
      item.run?.startsWith("node .github/scripts/run-affected.mjs"),
    );
    assert.equal(step.run, `node .github/scripts/run-affected.mjs ${task}`);
    assert.equal(
      step.env.WORKSPACES,
      `\${{ needs.changes.outputs.${task === "build" ? "build" : "ci"} }}`,
    );
    const result = execute(task, targets);
    assert.equal(result.status, 0, result.stderr);
    const args = JSON.parse(result.arguments);
    assert.deepEqual(args.slice(0, 4), ["exec", "turbo", "run", task]);
    for (const workspace of targets) assert.ok(args.includes(`--filter=${workspace}`));
  }
});

test("an affected connpass check failure fails the hosted command", () => {
  const result = execute("test", classifyChanges(["apps/connpass/app/root.tsx"]).ci, 17);
  assert.equal(result.status, 17);
  assert.ok(JSON.parse(result.arguments).includes("--filter=@gdgjp/connpass"));
});

test("empty and unknown workspace inputs fail before executing pnpm", () => {
  for (const workspaces of [[], ["@gdgjp/missing"], ["--filter=*"], null]) {
    const result = execute("test", workspaces);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /nonempty JSON array/);
  }
});
