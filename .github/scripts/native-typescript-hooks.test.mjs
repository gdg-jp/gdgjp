import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const aclGatePath = join(repositoryRoot, "cli/internal/wiki/hooks/acl-gate.ts");
const preCommitPath = join(repositoryRoot, ".codex/hooks/pre-commit-ci.ts");
const typescriptPath = join(repositoryRoot, "node_modules/typescript/bin/tsc");

function runNode(script, args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    ...options,
  });
}

function payload(toolName, extra = {}) {
  return JSON.stringify({
    hook_event_name: "preToolUse",
    tool_name: toolName,
    ...extra,
  });
}

async function makeClone() {
  const root = await mkdtemp(join(tmpdir(), "gdgjp-hook-clone-"));
  const configDir = join(root, ".gdgwiki");
  await mkdir(configDir);
  await writeFile(join(configDir, "config.json"), "{}\n", "utf8");
  return root;
}

async function makeFakeExecutable(directory, name, source) {
  const path = join(directory, name);
  await writeFile(path, `#!/usr/bin/env node\n${source}\n`, "utf8");
  await chmod(path, 0o755);
  return path;
}

test("ACL gate denies malformed preToolUse payloads", async () => {
  const root = await makeClone();
  const result = runNode(aclGatePath, [], { cwd: root, input: "{broken" });

  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).permission, "deny");
});

test("ACL gate does not invoke gdg for non-wk shell commands", async () => {
  const root = await makeClone();
  const binDir = await mkdtemp(join(tmpdir(), "gdgjp-hook-bin-"));
  const logPath = join(binDir, "gdg.log");
  const gdgPath = await makeFakeExecutable(
    binDir,
    "gdg",
    'require("node:fs").writeFileSync(process.env.FAKE_LOG, "called"); process.exit(1);',
  );
  const result = runNode(aclGatePath, [], {
    cwd: root,
    input: payload("Shell", { tool_input: { command: "git commit -m test" } }),
    env: { ...process.env, FAKE_LOG: logPath, GDG_BIN: gdgPath },
  });

  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).permission, "deny");
  assert.equal(existsSync(logPath), false);
});

test("ACL gate denies only the gdg ACL-violation exit status for wk git commit", async () => {
  const root = await makeClone();
  spawnSync("git", ["init", "-b", "main"], { cwd: root, encoding: "utf8" });
  const binDir = await mkdtemp(join(tmpdir(), "gdgjp-hook-gdg-"));
  const gdgPath = await makeFakeExecutable(
    binDir,
    "gdg",
    'process.stdout.write("missing ACL span"); process.exit(Number(process.env.FAKE_EXIT));',
  );
  const input = payload("Shell", { tool_input: { command: "wk git commit -m test" } });

  const violation = runNode(aclGatePath, [], {
    cwd: root,
    input,
    env: { ...process.env, FAKE_EXIT: "1", GDG_BIN: gdgPath },
  });
  assert.equal(violation.status, 0);
  assert.equal(JSON.parse(violation.stdout).permission, "deny");

  const infrastructureFailure = runNode(aclGatePath, [], {
    cwd: root,
    input,
    env: { ...process.env, FAKE_EXIT: "2", GDG_BIN: gdgPath },
  });
  assert.equal(infrastructureFailure.status, 0);
  assert.equal(infrastructureFailure.stdout, "");
  assert.match(infrastructureFailure.stderr, /allowing commit \(fail open\)/);
});

test("pre-commit hook does not invoke pnpm for malformed or non-commit payloads", async () => {
  const binDir = await mkdtemp(join(tmpdir(), "gdgjp-hook-pnpm-"));
  const logPath = join(binDir, "pnpm.log");
  await makeFakeExecutable(
    binDir,
    "pnpm",
    'require("node:fs").writeFileSync(process.env.FAKE_LOG, "called"); process.exit(1);',
  );
  const result = runNode(preCommitPath, [], {
    input: JSON.stringify({ tool_input: { command: "git status" } }),
    env: { ...process.env, FAKE_LOG: logPath, PATH: `${binDir}:${process.env.PATH}` },
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(existsSync(logPath), false);

  const malformed = runNode(preCommitPath, [], {
    input: "{broken",
    env: { ...process.env, FAKE_LOG: logPath, PATH: `${binDir}:${process.env.PATH}` },
  });
  assert.equal(malformed.status, 0);
  assert.equal(malformed.stdout, "");
  assert.equal(existsSync(logPath), false);
});

test("pre-commit hook denies a commit only when its CI check fails", async () => {
  const binDir = await mkdtemp(join(tmpdir(), "gdgjp-hook-pnpm-"));
  await makeFakeExecutable(
    binDir,
    "pnpm",
    'process.stderr.write("controlled CI failure"); process.exit(Number(process.env.FAKE_EXIT));',
  );
  const input = JSON.stringify({ tool_input: { command: "git commit -m test" } });
  const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}` };

  const failure = runNode(preCommitPath, [], {
    input,
    env: { ...env, FAKE_EXIT: "1" },
  });
  const failurePayload = JSON.parse(failure.stdout);
  assert.equal(failure.status, 0);
  assert.equal(failurePayload.hookSpecificOutput.permissionDecision, "deny");
  assert.match(failurePayload.systemMessage, /controlled CI failure/);

  const success = runNode(preCommitPath, [], {
    input,
    env: { ...env, FAKE_EXIT: "0" },
  });
  const successPayload = JSON.parse(success.stdout);
  assert.equal(success.status, 0);
  assert.equal(successPayload.hookSpecificOutput, undefined);
  assert.match(successPayload.systemMessage, /checks passed/);
});

test("node-script typecheck rejects non-erasable TypeScript syntax", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gdgjp-erasable-syntax-"));
  const sourcePath = join(directory, "enum.ts");
  await writeFile(sourcePath, "enum RuntimeValue { Example }\n", "utf8");

  const result = runNode(typescriptPath, [
    "--erasableSyntaxOnly",
    "--noEmit",
    "--skipLibCheck",
    "--target",
    "ESNext",
    sourcePath,
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /TS1294/);
});

test("clone hook package marker explicitly declares ESM", async () => {
  const packageJSON = JSON.parse(
    await readFile(join(repositoryRoot, "cli/internal/wiki/hooks/package.json"), "utf8"),
  );

  assert.equal(packageJSON.private, true);
  assert.equal(packageJSON.type, "module");
});
