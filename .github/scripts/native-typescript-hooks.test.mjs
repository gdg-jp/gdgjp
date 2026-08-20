import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    await readFile(join(repositoryRoot, "cli/internal/wiki/hooks/package.json"), "utf8"),
  );

  assert.equal(packageJSON.private, true);
  assert.equal(packageJSON.type, "module");
});
