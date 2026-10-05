import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const aclGatePath = join(repositoryRoot, "apps/cli/internal/wiki/hooks/acl-gate.ts");
const preCommitPath = join(repositoryRoot, ".codex/hooks/pre-commit-ci.ts");
const typescriptPath = join(repositoryRoot, "node_modules/typescript/bin/tsc");

function runNode(script, args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    ...options,
  });
}

function runNodeAsync(script, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { input, ...rest } = options;
    const child = spawn(process.execPath, [script, ...args], {
      ...rest,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    if (input) {
      child.stdin?.end(input);
    } else {
      child.stdin?.end();
    }
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

test("ACL gate allows wk ls even with trailing newline or safe quotes", async () => {
  const root = await makeClone();
  for (const command of ["wk ls pages/", "wk ls pages/\n", 'wk ls "pages/"', "wk ls 'pages/'"]) {
    const result = runNode(aclGatePath, [], {
      cwd: root,
      input: payload("Shell", { cwd: root, tool_input: { command } }),
    });
    assert.equal(result.status, 0, command);
    assert.equal(JSON.parse(result.stdout).permission, "allow", command);
  }

  const quotedExpansion = runNode(aclGatePath, [], {
    cwd: root,
    input: payload("Shell", { cwd: root, tool_input: { command: 'wk ls "pages/$x"' } }),
  });
  assert.equal(JSON.parse(quotedExpansion.stdout).permission, "deny");

  const globPages = runNode(aclGatePath, [], {
    cwd: root,
    input: payload("Glob", {
      cwd: root,
      tool_input: { glob_pattern: "*", target_directory: join(root, "pages") },
    }),
  });
  assert.equal(JSON.parse(globPages.stdout).permission, "deny");
  assert.match(globPages.stdout, /wk ls/);
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
  assert.equal(JSON.parse(infrastructureFailure.stdout).permission, "allow");
  assert.match(infrastructureFailure.stderr, /allowing commit \(fail open\)/);
});

test("ACL gate uses the authorization socket for verify-acl when present", async () => {
  const { createServer } = await import("node:http");
  const root = await makeClone();
  spawnSync("git", ["init", "-b", "main"], { cwd: root, encoding: "utf8" });
  const sockDir = await mkdtemp(join("/tmp", "gdgjp-authz-"));
  const sock = join("/tmp", `${sockDir.split("/").at(-1)}.sock`);
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    if (url.startsWith("/verify-acl?")) {
      const body = JSON.stringify({ findings: "missing ACL span" });
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }
    res.writeHead(400);
    res.end();
  });
  await new Promise((resolve, reject) => {
    server.listen(sock, () => resolve(undefined));
    server.on("error", reject);
  });
  try {
    const result = await runNodeAsync(aclGatePath, [], {
      cwd: root,
      input: payload("Shell", { tool_input: { command: "wk git commit -m test" } }),
      env: {
        ...process.env,
        XANGI_AUTHZ_NONCE: "test-nonce",
        XANGI_AUTHZ_SOCKET: sock,
        GDG_BIN: "/nonexistent/gdg",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout, result.stderr);
    assert.equal(JSON.parse(result.stdout).permission, "deny");
    assert.match(result.stdout, /missing ACL span/);
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
    await rm(sock, { force: true });
  }
});

test("ACL gate treats verify-acl 404 as an authorization rejection", async () => {
  const { createServer } = await import("node:http");
  const root = await makeClone();
  spawnSync("git", ["init", "-b", "main"], { cwd: root, encoding: "utf8" });
  const sockDir = await mkdtemp(join("/tmp", "gdgjp-authz-"));
  const sock = join("/tmp", `${sockDir.split("/").at(-1)}.sock`);
  const server = createServer((_req, res) => {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unknown_or_expired" }));
  });
  await new Promise((resolve, reject) => {
    server.listen(sock, () => resolve(undefined));
    server.on("error", reject);
  });
  try {
    const result = await runNodeAsync(aclGatePath, [], {
      cwd: root,
      input: payload("Shell", { tool_input: { command: "wk git commit -m test" } }),
      env: {
        ...process.env,
        XANGI_AUTHZ_NONCE: "test-nonce",
        XANGI_AUTHZ_SOCKET: sock,
        GDG_BIN: "/nonexistent/gdg",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).permission, "deny");
    assert.match(result.stdout, /unknown_or_expired/);
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
    await rm(sock, { force: true });
  }
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
  const root = await makeClone();
  const binDir = await mkdtemp(join(tmpdir(), "gdgjp-hook-pnpm-"));
  await makeFakeExecutable(
    binDir,
    "pnpm",
    'process.stderr.write("controlled CI failure"); process.exit(Number(process.env.FAKE_EXIT));',
  );
  const input = JSON.stringify({ tool_input: { command: "git commit -m test" } });
  const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}` };

  const failure = runNode(preCommitPath, [], {
    cwd: root,
    input,
    env: { ...env, FAKE_EXIT: "1" },
  });
  const failurePayload = JSON.parse(failure.stdout);
  assert.equal(failure.status, 0);
  assert.equal(failurePayload.hookSpecificOutput.permissionDecision, "deny");
  assert.match(failurePayload.systemMessage, /controlled CI failure/);

  const success = runNode(preCommitPath, [], {
    cwd: root,
    input,
    env: { ...env, FAKE_EXIT: "0" },
  });
  const successPayload = JSON.parse(success.stdout);
  assert.equal(success.status, 0);
  assert.equal(successPayload.hookSpecificOutput, undefined);
  assert.match(successPayload.systemMessage, /checks passed/);
});

test("installed Git hook runs CI once and still rejects a failing commit", async (t) => {
  const root = await makeClone();
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(git("init", "-b", "main").status, 0);
  git("config", "user.name", "CI test");
  git("config", "user.email", "ci@example.invalid");
  git("config", "core.hooksPath", ".githooks");
  await mkdir(join(root, ".githooks"));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "bin"));
  const hookPath = join(root, ".githooks/pre-commit");
  const hook = await readFile(join(repositoryRoot, ".githooks/pre-commit"), "utf8");
  await writeFile(hookPath, hook, { mode: 0o755 });
  await writeFile(
    join(root, "scripts/run-pre-commit-ci.mjs"),
    await readFile(join(repositoryRoot, "scripts/run-pre-commit-ci.mjs")),
  );
  const logPath = join(root, "calls");
  await makeFakeExecutable(
    join(root, "bin"),
    "pnpm",
    'require("node:fs").appendFileSync(process.env.FAKE_LOG, "ci\\n"); process.exit(1);',
  );
  const env = { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, FAKE_LOG: logPath };
  const check = (command) =>
    JSON.parse(
      runNode(preCommitPath, [], {
        cwd: root,
        env,
        input: JSON.stringify({ tool_input: { command } }),
      }).stdout,
    );

  for (const command of ["git commit -m test", "rtk git commit -am test"]) {
    assert.match(check(command).systemMessage, /Git pre-commit hook will run/);
    assert.equal(existsSync(logPath), false);
  }
  const commit = spawnSync("git", ["commit", "--allow-empty", "-m", "test"], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  assert.notEqual(commit.status, 0);
  assert.equal(await readFile(logPath, "utf8"), "ci\n");
  assert.notEqual(git("rev-parse", "--verify", "HEAD").status, 0);

  for (const command of [
    "git commit --no-verify -m test",
    "git commit -n -m test",
    "git commit -an -m test",
    "git commit '--no-verify' -m test",
    "git commit '-n' -m test",
    'git commit --no-"verify" -m test',
    "git commit --no-ver -m test",
    "git commit -anmtest",
    "git commit --no-{verify,verify} -m test",
    "git commit --no-* -m test",
    "git -c core.hooksPath=/dev/null commit -m test",
    "git commit -m test; echo done",
    "git commit -m $(echo test)",
  ]) {
    assert.equal(check(command).hookSpecificOutput.permissionDecision, "deny", command);
  }
  await chmod(hookPath, 0o644);
  assert.equal(check("git commit -m test").hookSpecificOutput.permissionDecision, "deny");
  await chmod(hookPath, 0o755);
  await writeFile(hookPath, "#!/bin/sh\nexit 0\n");
  assert.equal(check("git commit -m test").hookSpecificOutput.permissionDecision, "deny");
  await writeFile(hookPath, hook);
  git("config", "core.hooksPath", "/dev/null");
  assert.equal(check("git commit -m test").hookSpecificOutput.permissionDecision, "deny");
});

test("node-script typecheck rejects non-erasable TypeScript syntax", async () => {
  if (!existsSync(typescriptPath)) {
    // This job does not run `pnpm install`; skip when tsc is unavailable.
    return;
  }
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
  assert.match(`${result.stdout}\n${result.stderr}`, /TS1294/);
});

test("clone hook package marker explicitly declares ESM", async () => {
  const packageJSON = JSON.parse(
    await readFile(join(repositoryRoot, "apps/cli/internal/wiki/hooks/package.json"), "utf8"),
  );

  assert.equal(packageJSON.private, true);
  assert.equal(packageJSON.type, "module");
});
