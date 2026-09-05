import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bootstrapScript = join(repositoryRoot, "scripts/install-gdg-agent-host.sh");
const defaultSpec = join(repositoryRoot, "agent-host/agent-host.json");

let compiledGdgBin = "";

function ensureGdgBin() {
  if (compiledGdgBin && existsSync(compiledGdgBin)) {
    return compiledGdgBin;
  }
  if (process.env.GDG_BIN && existsSync(process.env.GDG_BIN)) {
    compiledGdgBin = process.env.GDG_BIN;
    return compiledGdgBin;
  }
  const bin = join(tmpdir(), `gdg-emit-layout-${process.pid}`);
  const result = spawnSync("go", ["build", "-o", bin, "./cmd/gdg"], {
    cwd: join(repositoryRoot, "cli"),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`go build failed: ${result.stderr || result.stdout}`);
  }
  compiledGdgBin = bin;
  return compiledGdgBin;
}

function emitLayout(env, extraArgs = []) {
  const bin = env.GDG_BIN || ensureGdgBin();
  const args = ["agent-host", "emit-layout"];
  if (env.GDG_SPEC) {
    args.push("--spec", env.GDG_SPEC);
  } else {
    args.push("--spec", defaultSpec);
  }
  if (env.GDG_SETUP_PREFIX) {
    args.push("--prefix", env.GDG_SETUP_PREFIX);
  }
  if (env.GDG_AGENT_SLOT_COUNT) {
    args.push("--slot-count", env.GDG_AGENT_SLOT_COUNT);
  }
  args.push(...extraArgs);
  return spawnSync(bin, args, { encoding: "utf8", env: { ...env, GDG_BIN: bin } });
}

function applyLayout(env, extraArgs = []) {
  const bin = env.GDG_BIN || ensureGdgBin();
  const args = ["agent-host", "apply"];
  if (env.GDG_SPEC) {
    args.push("--spec", env.GDG_SPEC);
  } else {
    args.push("--spec", defaultSpec);
  }
  if (env.GDG_SETUP_PREFIX) {
    args.push("--prefix", env.GDG_SETUP_PREFIX);
  }
  if (env.GDG_AGENT_SLOT_COUNT) {
    args.push("--slot-count", env.GDG_AGENT_SLOT_COUNT);
  }
  args.push(...extraArgs);
  return spawnSync(bin, args, { encoding: "utf8", env: { ...env, GDG_BIN: bin } });
}

function verifyHost(env, extraArgs = []) {
  const bin = env.GDG_BIN || ensureGdgBin();
  const args = ["agent-host", "verify"];
  if (env.GDG_SPEC) {
    args.push("--spec", env.GDG_SPEC);
  } else {
    args.push("--spec", defaultSpec);
  }
  if (env.GDG_SETUP_PREFIX) {
    args.push("--prefix", env.GDG_SETUP_PREFIX);
  }
  args.push(...extraArgs);
  return spawnSync(bin, args, { encoding: "utf8", env: { ...env, GDG_BIN: bin } });
}

async function withLayoutFixture(run) {
  const prefix = await mkdtemp(join(tmpdir(), "gdg-agent-layout-"));
  try {
    const env = {
      ...process.env,
      GDG_SETUP_PREFIX: prefix,
      GDG_AGENT_SLOT_COUNT: "4",
      GDG_BIN: ensureGdgBin(),
    };
    const result = emitLayout(env);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await run({ prefix, env });
  } finally {
    await rm(prefix, { recursive: true, force: true });
  }
}

test("agent layout is idempotent, root-owned templates, and has no sudoers wildcards", async () => {
  await withLayoutFixture(async ({ prefix, env }) => {
    const staleWrapper = join(prefix, "opt/gdg-agent/bin/google-workspace-mcp");
    await writeFile(staleWrapper, "#!/bin/sh\necho stale\n", { mode: 0o755 });

    const again = emitLayout(env);
    assert.equal(again.status, 0, again.stderr || again.stdout);
    assert.equal(
      existsSync(staleWrapper),
      false,
      "emit-layout must remove wrappers left over from superseded designs",
    );

    const sudoers = await readFile(join(prefix, "etc/sudoers.d/gdg-agent"), "utf8");
    assert.doesNotMatch(sudoers, /[*\?]/);
    assert.match(sudoers, /spawn-slot-0$/m);
    assert.match(sudoers, /spawn-slot-3$/m);
    assert.match(sudoers, /NOPASSWD: \/opt\/gdg-agent\/bin\/spawn-slot-0$/m);

    const sandbox0 = JSON.parse(
      await readFile(join(prefix, "home/gdgagent-run-0/.cursor/sandbox.json"), "utf8"),
    );
    const sandbox1 = JSON.parse(
      await readFile(join(prefix, "home/gdgagent-run-1/.cursor/sandbox.json"), "utf8"),
    );
    assert.deepEqual(sandbox0.additionalReadonlyPaths, [
      "/opt/gdg-agent/lib",
      "/opt/gdg-agent/bin",
      "/usr/bin",
      "/usr/lib",
      "/run/gdg-agent/0",
    ]);
    assert.equal(sandbox1.additionalReadonlyPaths.at(-1), "/run/gdg-agent/1");
    assert.ok(!JSON.stringify(sandbox0).includes(".config/gdg"));
    assert.ok(!JSON.stringify(sandbox0).includes(".config/xangi"));
    assert.ok(!sandbox0.additionalReadonlyPaths.includes("/run/gdg-agent"));

    const cliConfig = JSON.parse(
      await readFile(join(prefix, "home/gdgagent-run-0/.cursor/cli-config.json"), "utf8"),
    );
    assert.equal(cliConfig.sandbox.mode, "enabled");
    assert.equal(cliConfig.sandbox.readBoundary, "workspace");
    assert.equal(cliConfig.approvalMode, "allowlist");

    const hooks = JSON.parse(
      await readFile(join(prefix, "home/gdgagent-run-0/.cursor/hooks.json"), "utf8"),
    );
    assert.equal(hooks.hooks.preToolUse[0].failClosed, true);
    assert.match(hooks.hooks.preToolUse[0].command, /^\/usr\/bin\/node /);

    const mcp = JSON.parse(
      await readFile(join(prefix, "home/gdgagent-run-2/.cursor/mcp.json"), "utf8"),
    );
    assert.deepEqual(Object.keys(mcp.mcpServers), ["gdg-index"]);
    assert.equal(
      mcp.mcpServers["gdg-index"].env.AGENTS_INDEX_SOCKET,
      "/run/gdg-agent/2/index.sock",
    );

    const launcher = await readFile(join(prefix, "opt/gdg-agent/bin/spawn-slot-1"), "utf8");
    assert.match(launcher, /takes no arguments/);
    assert.match(launcher, /SLOT="1"/);
    assert.match(launcher, /PATH="\/opt\/gdg-agent\/bin:\/usr\/bin:\/bin"/);
    assert.match(launcher, /cp \/opt\/gdg-agent\/lib\/cli-config\.json/);
    const gwsWrapper = await readFile(join(prefix, "opt/gdg-agent/bin/gws"), "utf8");
    assert.match(gwsWrapper, /exec \/usr\/bin\/node ".*\/lib\/gws\.ts" "\$@"/);
    const gwsHook = await stat(join(prefix, "opt/gdg-agent/lib/gws.ts"));
    assert.equal(gwsHook.mode & 0o777, 0o444);
    const permissions = JSON.parse(
      await readFile(join(prefix, "home/gdgagent-run-0/.cursor/permissions.json"), "utf8"),
    );
    assert.deepEqual(permissions.gwsAllowlist, ["drive files list", "drive files get"]);

    const cursorDir = await stat(join(prefix, "home/gdgagent-run-0/.cursor"));
    assert.equal(cursorDir.isDirectory(), true);
    assert.equal(cursorDir.isSymbolicLink(), false);
    assert.equal(cursorDir.mode & 0o1777, 0o1775);
    const projectsDir = await stat(join(prefix, "home/gdgagent-run-0/.cursor/projects"));
    assert.equal(projectsDir.isDirectory(), true);

    const wk = await stat(join(prefix, "opt/gdg-agent/bin/wk"));
    assert.equal(wk.mode & 0o111, 0o111);

    const wiki = await stat(join(prefix, "srv/gdg-agent/wiki"));
    assert.equal(wiki.mode & 0o7777, 0o2770);

    const sudoersAgain = await readFile(join(prefix, "etc/sudoers.d/gdg-agent"), "utf8");
    assert.match(sudoersAgain, /pkill -KILL -u gdgagent-run-0$/m);

    for (const name of ["hooks.json", "sandbox.json", "mcp.json"]) {
      const info = await stat(join(prefix, "home/gdgagent-run-0/.cursor", name));
      assert.equal(info.mode & 0o777, 0o444, name);
    }
    const liveCliConfig = await stat(join(prefix, "home/gdgagent-run-0/.cursor/cli-config.json"));
    assert.equal(liveCliConfig.mode & 0o777, 0o644);
    const canonicalCliConfig = await stat(join(prefix, "opt/gdg-agent/lib/cli-config.json"));
    assert.equal(canonicalCliConfig.mode & 0o777, 0o444);
    const libHook = await stat(join(prefix, "opt/gdg-agent/lib/wk.ts"));
    assert.equal(libHook.mode & 0o777, 0o444);

    const execSpawn = await readFile(join(prefix, "opt/gdg-agent/lib/exec-spawn.ts"), "utf8");
    assert.match(execSpawn, /HOME: home/);
    assert.match(execSpawn, /spawn\(spec\.command, args,/);
    assert.doesNotMatch(execSpawn, /spawn\(spec\.command, \["--mcp-config"/);
  });
});

test("bootstrap scripts/install-gdg-agent-host.sh is <= 60 lines and matches spec pins", async () => {
  assert.equal(existsSync(bootstrapScript), true, "bootstrap script must exist");
  const st = await stat(bootstrapScript);
  assert.equal(st.mode & 0o111, 0o111, "bootstrap script must be executable");
  const content = await readFile(bootstrapScript, "utf8");
  const lines = content.trim().split("\n").length;
  assert.ok(lines <= 60, `bootstrap script must be <= 60 lines, got ${lines}`);
  assert.match(content, /UBUNTU_CODENAME/);
  assert.match(content, /exec \/usr\/local\/bin\/gdg agent-host apply/);

  const spec = JSON.parse(await readFile(defaultSpec, "utf8"));
  const versionMatch = content.match(/GDG_VERSION="([^"]+)"/);
  const templateMatch = content.match(/GDG_ASSET_TEMPLATE="([^"]+)"/);
  const x86Match = content.match(/GDG_SHA256_X86_64="([^"]+)"/);
  const aarchMatch = content.match(/GDG_SHA256_AARCH64="([^"]+)"/);

  assert.ok(versionMatch, "GDG_VERSION must be defined");
  assert.ok(templateMatch, "GDG_ASSET_TEMPLATE must be defined");
  assert.ok(x86Match, "GDG_SHA256_X86_64 must be defined");
  assert.ok(aarchMatch, "GDG_SHA256_AARCH64 must be defined");

  assert.equal(versionMatch[1], spec.pins.gdgCli.version);
  assert.equal(templateMatch[1], spec.pins.gdgCli.assetTemplate);
  assert.equal(x86Match[1], spec.pins.gdgCli.sha256.x86_64);
  assert.equal(aarchMatch[1], spec.pins.gdgCli.sha256.aarch64);
});

test("legacy bash installer and verify scripts are deleted", () => {
  assert.equal(
    existsSync(join(repositoryRoot, "agent-host/install.sh")),
    false,
    "agent-host/install.sh must be removed; replaced by Go converger",
  );
  assert.equal(
    existsSync(join(repositoryRoot, "agent-host/lib/verify.sh")),
    false,
    "agent-host/lib/verify.sh must be removed; replaced by gdg agent-host verify",
  );
  assert.equal(
    existsSync(join(repositoryRoot, "agents-index/install.sh")),
    false,
    "agents-index/install.sh must be removed; folded into gdg agent-host apply (Stage 08)",
  );
  assert.equal(
    existsSync(join(repositoryRoot, ".github/scripts/agents-index-install.test.mjs")),
    false,
    "agents-index-install.test.mjs must be removed; assertions moved to the golden tree and agentsindex_test.go",
  );
});

test("tracked *.sh files match the checked-in shell allowlist", async () => {
  const ls = spawnSync("git", ["ls-files", "*.sh"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(ls.status, 0, ls.stderr);
  const tracked = ls.stdout.trim().split("\n").filter(Boolean).sort();

  const allowlistRaw = await readFile(
    join(repositoryRoot, ".github/scripts/shell-allowlist.txt"),
    "utf8",
  );
  const allowlist = allowlistRaw.trim().split("\n").filter(Boolean).sort();

  assert.deepEqual(
    tracked,
    allowlist,
    "git ls-files '*.sh' drifted from .github/scripts/shell-allowlist.txt. " +
      "Adding a shell script must show up as an allowlist change in the PR diff.",
  );

  // The agent-host provisioning path is a single shell (the bootstrap). The only
  // *.sh allowed under agent-host/ are the Lima dev helpers and the spawn-slot
  // template, never a provisioning installer.
  const agentHostShells = allowlist.filter((p) => p.startsWith("agent-host/"));
  for (const path of agentHostShells) {
    assert.ok(
      path.startsWith("agent-host/dev/") || path === "agent-host/config/spawn-slot.sh",
      `unexpected shell under agent-host/: ${path} (provisioning must be bootstrap-only)`,
    );
  }
});

test("gdg agent-host apply prefix mode writes layout", async () => {
  const prefix = await mkdtemp(join(tmpdir(), "gdg-agent-install-"));
  try {
    const env = {
      ...process.env,
      GDG_SETUP_PREFIX: prefix,
      GDGJP_ROOT: repositoryRoot,
      GDG_AGENT_SLOT_COUNT: "4",
    };
    const result = applyLayout(env);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const wk = await stat(join(prefix, "opt/gdg-agent/bin/wk"));
    assert.equal(wk.mode & 0o111, 0o111);

    const slotMcp = await readFile(join(prefix, "home/gdgagent-run-0/.cursor/mcp.json"), "utf8");
    assert.match(slotMcp, /gdg-index/);

    // Systemd units written under prefix
    const modelConf = await readFile(
      join(prefix, "home/gdgagent-svc/.config/systemd/user/xangi.service.d/model.conf"),
      "utf8",
    );
    assert.match(modelConf, /AGENT_MODEL=composer-2.5/);

    const apparmor = await readFile(
      join(prefix, "etc/apparmor.d/cursor-agent-cursorsandbox"),
      "utf8",
    );
    assert.match(apparmor, /profile cursor-agent-cursorsandbox/);

    const spec = JSON.parse(
      await readFile(join(repositoryRoot, "agent-host/agent-host.json"), "utf8"),
    );
    assert.equal(spec.slotCount, 4);
    assert.equal(spec.backend.model, "composer-2.5");
    assert.equal(spec.pins.cursorAgent.version, "2026.08.11-e8db854");
    assert.ok(spec.pins.cursorAgent.sha256.x86_64);
    assert.ok(spec.pins.cursorAgent.sha256.aarch64);
    assert.equal(spec.pins.gdgCli.version, "0.4.0");
    assert.equal(spec.pins.gdgCli.assetTemplate, "gdg_{version}_linux_{arch}.zip");
    assert.ok(spec.pins.gdgCli.sha256.x86_64);
    assert.ok(spec.pins.gdgCli.sha256.aarch64);
    assert.equal(spec.pins.xangi.ref, "b3db5919a5e33769ef8d7bcef245aa6b76974948");
    assert.equal(spec.pins.gws.version, "v0.22.5");

    const cliConfigSrc = await readFile(
      join(repositoryRoot, "agent-host/config/backends/cursor/cli-config.json"),
      "utf8",
    );
    assert.doesNotMatch(cliConfigSrc, /google-workspace/);
    assert.match(cliConfigSrc, /Shell\(gws\)/);
    assert.match(cliConfigSrc, /Shell\(\/opt\/gdg-agent\/bin\/gws\)/);

    assert.equal(
      existsSync(join(repositoryRoot, "agent-host/langfuse-forwarder/package-lock.json")),
      true,
      "agent-host/langfuse-forwarder must retain package-lock.json for deterministic npm ci",
    );
    assert.equal(
      existsSync(join(repositoryRoot, "agent-host/setup.sh")),
      false,
      "agent-host/setup.sh must be removed; 13 checks are in verify",
    );
    assert.equal(
      existsSync(join(repositoryRoot, "agent-host/lib/install-layout.sh")),
      false,
      "agent-host/lib/install-layout.sh must be removed; layout is gdg agent-host apply",
    );
    assert.equal(
      existsSync(join(repositoryRoot, "agent-host/lib/apply-ownership.sh")),
      false,
      "agent-host/lib/apply-ownership.sh must be removed",
    );
    assert.equal(
      existsSync(join(repositoryRoot, "skills-lock.json")),
      false,
      "unverifiable skills-lock.json in root must be removed",
    );
    assert.equal(
      existsSync(join(repositoryRoot, "agent-host/skills-lock.json")),
      false,
      "unverifiable skills-lock.json in agent-host must be removed",
    );
    const aclGateSrc = await readFile(
      join(repositoryRoot, "cli/internal/wiki/hooks/acl-gate.ts"),
      "utf8",
    );
    assert.doesNotMatch(aclGateSrc, /debugGwsSnapshot/);
    assert.doesNotMatch(aclGateSrc, /gws-acl-debug/);
    const provisionSrc = await readFile(
      join(repositoryRoot, "agent-host/dev/provision.sh"),
      "utf8",
    );
    assert.match(provisionSrc, /--exclude \/agent-host\/wiki/);
    assert.match(provisionSrc, /readonly xangi_source=\/mnt\/xangi-src/);
    assert.match(provisionSrc, /rsync -a --delete --exclude node_modules "\$xangi_source\/"/);
    assert.doesNotMatch(provisionSrc, /systemctl --user start/);
    const seedIam = join(repositoryRoot, "agent-host/dev/seed-iam.sh");
    const seedIamStat = await stat(seedIam);
    assert.equal(seedIamStat.mode & 0o111, 0o111);
    const seedIamSrc = await readFile(seedIam, "utf8");
    assert.doesNotMatch(seedIamSrc, /--activate|install\.sh/);
    assert.match(seedIamSrc, /0600/);
    assert.match(seedIamSrc, /gdgagent-svc/);
    assert.match(seedIamSrc, /\.gdgwiki\/config\.json/);
    assert.match(seedIamSrc, /not a wiki clone yet/);
    assert.equal(
      existsSync(join(repositoryRoot, "agent-host/dev/configure-google-workspace-mcp.sh")),
      false,
      "the device-local OAuth-tunnel dev script must not come back",
    );
    assert.equal(
      existsSync(join(repositoryRoot, "agent-host/dev/open-google-workspace-oauth-tunnel.sh")),
      false,
      "the device-local OAuth-tunnel dev script must not come back",
    );
    const seedGwsFakeToken = join(repositoryRoot, "agent-host/dev/seed-gws-fake-token.sh");
    const seedGwsFakeTokenStat = await stat(seedGwsFakeToken);
    assert.equal(seedGwsFakeTokenStat.mode & 0o111, 0o111);
    const seedGwsFakeTokenSrc = await readFile(seedGwsFakeToken, "utf8");
    assert.match(seedGwsFakeTokenSrc, /Run with sudo inside the VM/);
    assert.match(seedGwsFakeTokenSrc, /XANGI_AUTHZ_SOCKET/);
    assert.match(seedGwsFakeTokenSrc, /XANGI_AUTHZ_NONCE/);
    const gwsFakeTokenStub = join(repositoryRoot, "agent-host/dev/gws-fake-token-stub.mjs");
    const gwsFakeTokenStubSrc = await readFile(gwsFakeTokenStub, "utf8");
    assert.match(gwsFakeTokenStubSrc, /\/resolve/);
    assert.match(gwsFakeTokenStubSrc, /\/workspace-token/);
    assert.match(gwsFakeTokenStubSrc, /fake/i);
    const iamFixture = await readFile(
      join(repositoryRoot, "agent-host/dev/iam-fixture.json"),
      "utf8",
    );
    const fixture = JSON.parse(iamFixture);
    assert.equal(fixture.version, 1);
    const guildIds = Object.keys(fixture.guilds);
    assert.equal(guildIds.length, 1);
    const guild = fixture.guilds[guildIds[0]];
    const channelKeys = Object.keys(guild.channels).sort();
    assert.deepEqual(channelKeys, ["ch-chapter", "ch-national", "ch-other"]);
    assert.deepEqual(Object.keys(guild.roles), ["role-organizer"]);
    assert.equal(guild.roles["role-organizer"].role, "organizer");
    assert.notEqual(guild.chapterId, guild.channels["ch-other"].chapterId);
    assert.equal(new Date(guild.boundAt).toISOString(), guild.boundAt);
    const limaConfig = await readFile(
      join(repositoryRoot, "agent-host/dev/lima-gdg-agent.yaml"),
      "utf8",
    );
    assert.match(limaConfig, /mountPoint: \/mnt\/xangi-src/);
    assert.equal(
      existsSync(join(repositoryRoot, "agent-host/workspace/.agents/skills/wiki-ingest/SKILL.md")),
      true,
    );
  } finally {
    await rm(prefix, { recursive: true, force: true });
  }
});

// agents-index.service runs `node /opt/agents-index/src/cli.ts` through Node's
// strip-only TypeScript loader. Non-erasable syntax (parameter properties, enums,
// namespaces) makes that a restart loop with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX.
// Load every rendered daemon source and assert the loader accepts it. Missing
// npm deps surface as ERR_MODULE_NOT_FOUND, which is fine here — the loader ran.
test("rendered agents-index daemon sources load under Node's strip-only loader", async () => {
  const prefix = await mkdtemp(join(tmpdir(), "gdg-agent-ai-smoke-"));
  try {
    const result = emitLayout({
      ...process.env,
      GDG_SETUP_PREFIX: prefix,
      GDG_AGENT_SLOT_COUNT: "4",
      GDG_BIN: ensureGdgBin(),
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const srcRoot = join(prefix, "opt/agents-index/src");
    const walk = async (dir) => {
      const out = [];
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) out.push(...(await walk(p)));
        else if (e.name.endsWith(".ts")) out.push(p);
      }
      return out;
    };
    const files = await walk(srcRoot);
    assert.ok(files.length >= 10, `expected the daemon tree, found ${files.length} files`);

    for (const file of files) {
      const run = spawnSync(process.execPath, [file], { encoding: "utf8" });
      assert.doesNotMatch(
        run.stderr ?? "",
        /ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/,
        `${file} contains non-erasable TypeScript; the deployed daemon cannot load it:\n${run.stderr}`,
      );
    }
  } finally {
    await rm(prefix, { recursive: true, force: true });
  }
});

test("agent-host/workspace/ contains no private Google Drive/Sheets URLs or Discord IDs", async () => {
  const workspaceDir = join(repositoryRoot, "agent-host/workspace");
  const entries = await readdir(workspaceDir, { recursive: true, withFileTypes: true });
  assert.ok(entries.length > 0, "agent-host/workspace must not be empty");

  const privateUrlPattern = /docs\.google\.com|drive\.google\.com|discord\.com\/channels/;
  const discordSnowflakePattern = /\b[0-9]{17,20}\b/;
  const violations = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parent = entry.parentPath ?? entry.path;
    const fullPath = join(parent, entry.name);
    const content = await readFile(fullPath, "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (privateUrlPattern.test(line) || discordSnowflakePattern.test(line)) {
        violations.push(`${fullPath}:${i + 1}: ${line}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Found private URLs or Discord IDs in agent-host/workspace:\n${violations.join("\n")}`,
  );
});

test("monorepo .gitmodules contains no agents-local or nested wiki submodules", async () => {
  const gitmodulesPath = join(repositoryRoot, ".gitmodules");
  if (existsSync(gitmodulesPath)) {
    const content = await readFile(gitmodulesPath, "utf8");
    assert.doesNotMatch(content, /submodule\s+"agents-local"/);
    assert.doesNotMatch(content, /submodule\s+"wiki"/);
    assert.doesNotMatch(content, /gdg-wiki::/);
  }
});

test("agent-host.json slotCount changes propagate to sudoers, tmpfiles, and per-slot configs", async () => {
  const prefix = await mkdtemp(join(tmpdir(), "gdg-agent-slot-count-"));
  const specDir = await mkdtemp(join(tmpdir(), "gdg-agent-spec-"));
  try {
    const baseSpec = JSON.parse(
      await readFile(join(repositoryRoot, "agent-host/agent-host.json"), "utf8"),
    );
    const customSpec = { ...baseSpec, slotCount: 3 };
    const customSpecPath = join(specDir, "agent-host.json");
    await writeFile(customSpecPath, JSON.stringify(customSpec, null, 2), "utf8");

    const { GDG_AGENT_SLOT_COUNT: _omitted, ...cleanEnv } = process.env;
    const env = {
      ...cleanEnv,
      GDG_SPEC: customSpecPath,
      GDG_SETUP_PREFIX: prefix,
      GDG_BIN: ensureGdgBin(),
    };

    const result = emitLayout(env);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const sudoers = await readFile(join(prefix, "etc/sudoers.d/gdg-agent"), "utf8");
    assert.match(sudoers, /spawn-slot-0$/m);
    assert.match(sudoers, /spawn-slot-2$/m);
    assert.doesNotMatch(sudoers, /spawn-slot-3$/m);

    const tmpfiles = await readFile(join(prefix, "etc/tmpfiles.d/gdg-agent.conf"), "utf8");
    assert.match(tmpfiles, /\/run\/gdg-agent\/2\b/);
    assert.doesNotMatch(tmpfiles, /\/run\/gdg-agent\/3\b/);

    assert.equal(existsSync(join(prefix, "home/gdgagent-run-2/.cursor/sandbox.json")), true);
    assert.equal(existsSync(join(prefix, "home/gdgagent-run-3/.cursor/sandbox.json")), false);

    // agents-index is folded into the same spec: --slots and SupplementaryGroups
    // follow slotCount, with no /opt/gdgjp checkout dependency. It is a system
    // unit (User=/Group=) because a --user manager cannot set the slot groups
    // the daemon needs to chgrp the per-slot index sockets.
    const unit = await readFile(join(prefix, "etc/systemd/system/agents-index.service"), "utf8");
    assert.match(unit, /^User=gdgagent-svc$/m);
    assert.match(unit, /^Group=gdgagent-svc$/m);
    assert.match(unit, /^WantedBy=multi-user\.target$/m);
    assert.match(unit, /--slots 3 /);
    assert.match(
      unit,
      /SupplementaryGroups=gdgwiki gdgagent-run-0 gdgagent-run-1 gdgagent-run-2$/m,
    );
    assert.doesNotMatch(unit, /gdgagent-run-3/);
    assert.doesNotMatch(unit, /\/opt\/gdgjp/);
    assert.match(unit, /# gdg-artifacts-rev: [0-9a-f]{16}/);
    assert.match(unit, /ExecStart=\/usr\/bin\/node \/opt\/agents-index\/src\/cli\.ts watch/);

    // The daemon deploys self-contained; the ACL import is rewritten off @gdgjp/gdg-lib.
    const filter = await readFile(join(prefix, "opt/agents-index/src/acl/filter.ts"), "utf8");
    assert.doesNotMatch(filter, /@gdgjp\/gdg-lib/);
    assert.match(filter, /from "\.\/agent\.ts"/);
    assert.equal(existsSync(join(prefix, "opt/agents-index/src/acl/agent.ts")), true);
    assert.equal(existsSync(join(prefix, "opt/agents-index/package-lock.json")), true);
  } finally {
    await rm(prefix, { recursive: true, force: true });
    await rm(specDir, { recursive: true, force: true });
  }
});

test("validate-then-rename preserves existing sudoers if validation fails", async () => {
  const prefix = await mkdtemp(join(tmpdir(), "gdg-agent-sudoers-fail-"));
  const fakeBinDir = await mkdtemp(join(tmpdir(), "fake-bin-"));
  try {
    const sudoersDir = join(prefix, "etc/sudoers.d");
    const sudoersFile = join(sudoersDir, "gdg-agent");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(sudoersDir, { recursive: true });
    const originalContent = "# ORIGINAL LIVE SUDOERS CONTENT\n";
    await writeFile(sudoersFile, originalContent, { mode: 0o440 });

    const fakeVisudo = join(fakeBinDir, "visudo");
    await writeFile(fakeVisudo, "#!/bin/sh\necho 'simulated syntax error' >&2\nexit 1\n", {
      mode: 0o755,
    });

    const env = {
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH}`,
      GDG_SETUP_PREFIX: prefix,
      GDG_AGENT_SLOT_COUNT: "4",
      GDG_BIN: ensureGdgBin(),
    };

    const result = emitLayout(env);
    assert.notEqual(result.status, 0, "emit-layout must fail when visudo validation fails");

    const contentAfterFailure = await readFile(sudoersFile, "utf8");
    assert.equal(
      contentAfterFailure,
      originalContent,
      "Existing live sudoers file must remain unchanged on validation failure",
    );
  } finally {
    await rm(prefix, { recursive: true, force: true });
    await rm(fakeBinDir, { recursive: true, force: true });
  }
});

test("gdg agent-host verify exits 0 in prefix mode", async () => {
  const result = verifyHost({
    ...process.env,
    GDG_SETUP_PREFIX: "/tmp/fake-prefix",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /prefix mode active/);
});

test("installer and layout fail closed on missing or malformed spec", async () => {
  const prefix = await mkdtemp(join(tmpdir(), "gdg-agent-fail-closed-"));
  const badSpecDir = await mkdtemp(join(tmpdir(), "gdg-agent-bad-spec-"));
  try {
    const missingSpecPath = join(badSpecDir, "nonexistent.json");
    const missingSpecResult = emitLayout({
      ...process.env,
      GDG_SPEC: missingSpecPath,
      GDG_SETUP_PREFIX: prefix,
      GDG_BIN: ensureGdgBin(),
    });
    assert.notEqual(missingSpecResult.status, 0);
    assert.match(missingSpecResult.stderr, /spec file not found/);

    const malformedSpecPath = join(badSpecDir, "malformed.json");
    await writeFile(malformedSpecPath, "{ invalid json", "utf8");
    const malformedResult = emitLayout({
      ...process.env,
      GDG_SPEC: malformedSpecPath,
      GDG_SETUP_PREFIX: prefix,
      GDG_BIN: ensureGdgBin(),
    });
    assert.notEqual(malformedResult.status, 0);
    assert.match(malformedResult.stderr, /Failed to parse spec/);

    const incompleteSpecPath = join(badSpecDir, "incomplete.json");
    await writeFile(incompleteSpecPath, JSON.stringify({ slotCount: 4 }), "utf8");
    const incompleteResult = emitLayout({
      ...process.env,
      GDG_SPEC: incompleteSpecPath,
      GDG_SETUP_PREFIX: prefix,
      GDG_BIN: ensureGdgBin(),
    });
    assert.notEqual(incompleteResult.status, 0);
    assert.match(incompleteResult.stderr, /spec\.paths must be an object/);
  } finally {
    await rm(prefix, { recursive: true, force: true });
    await rm(badSpecDir, { recursive: true, force: true });
  }
});

test("slotCount reduction reconciles obsolete slots and artifacts", async () => {
  const prefix = await mkdtemp(join(tmpdir(), "gdg-agent-reduction-"));
  try {
    const env4 = {
      ...process.env,
      GDG_SETUP_PREFIX: prefix,
      GDG_AGENT_SLOT_COUNT: "4",
      GDG_BIN: ensureGdgBin(),
    };
    const res4 = emitLayout(env4);
    assert.equal(res4.status, 0, res4.stderr || res4.stdout);

    assert.ok(existsSync(join(prefix, "opt/gdg-agent/bin/spawn-slot-3")));
    assert.ok(existsSync(join(prefix, "run/gdg-agent/3")));
    assert.ok(existsSync(join(prefix, "home/gdgagent-run-3/.cursor/sandbox.json")));

    const env3 = {
      ...process.env,
      GDG_SETUP_PREFIX: prefix,
      GDG_AGENT_SLOT_COUNT: "3",
      GDG_BIN: ensureGdgBin(),
    };
    const res3 = emitLayout(env3);
    assert.equal(res3.status, 0, res3.stderr || res3.stdout);

    assert.ok(!existsSync(join(prefix, "opt/gdg-agent/bin/spawn-slot-3")));
    assert.ok(!existsSync(join(prefix, "run/gdg-agent/3")));
    assert.ok(!existsSync(join(prefix, "home/gdgagent-run-3/.cursor")));

    assert.ok(existsSync(join(prefix, "opt/gdg-agent/bin/spawn-slot-2")));
    assert.ok(existsSync(join(prefix, "run/gdg-agent/2")));
    assert.ok(existsSync(join(prefix, "home/gdgagent-run-2/.cursor/sandbox.json")));

    const sudoers = await readFile(join(prefix, "etc/sudoers.d/gdg-agent"), "utf8");
    assert.match(sudoers, /spawn-slot-2/);
    assert.doesNotMatch(sudoers, /spawn-slot-3/);

    const tmpfiles = await readFile(join(prefix, "etc/tmpfiles.d/gdg-agent.conf"), "utf8");
    assert.match(tmpfiles, /\/2 0750/);
    assert.doesNotMatch(tmpfiles, /\/3 0750/);
  } finally {
    await rm(prefix, { recursive: true, force: true });
  }
});

test("spec paths govern all generated layout configurations", async () => {
  const prefix = await mkdtemp(join(tmpdir(), "gdg-agent-custom-paths-"));
  const customSpecDir = await mkdtemp(join(tmpdir(), "gdg-agent-custom-spec-"));
  try {
    const baseSpec = JSON.parse(
      await readFile(join(repositoryRoot, "agent-host/agent-host.json"), "utf8"),
    );
    const customSpec = {
      ...baseSpec,
      slotCount: 2,
      paths: {
        agentRoot: "/opt/custom-agent",
        workspace: "/srv/custom-wiki",
        runRoot: "/run/custom-agent",
      },
    };
    const customSpecPath = join(customSpecDir, "agent-host.json");
    await writeFile(customSpecPath, JSON.stringify(customSpec, null, 2), "utf8");

    const env = {
      ...process.env,
      GDG_SPEC: customSpecPath,
      GDG_SETUP_PREFIX: prefix,
      GDG_BIN: ensureGdgBin(),
    };
    const res = emitLayout(env);
    assert.equal(res.status, 0, res.stderr || res.stdout);

    // Sudoers
    const sudoers = await readFile(join(prefix, "etc/sudoers.d/gdg-agent"), "utf8");
    assert.match(sudoers, /\/opt\/custom-agent\/bin\/spawn-slot-0/);
    assert.doesNotMatch(sudoers, /\/opt\/gdg-agent/);

    // Tmpfiles
    const tmpfiles = await readFile(join(prefix, "etc/tmpfiles.d/gdg-agent.conf"), "utf8");
    assert.match(tmpfiles, /d \/run\/custom-agent 0755/);
    assert.match(tmpfiles, /d \/run\/custom-agent\/0 0750/);
    assert.doesNotMatch(tmpfiles, /\/run\/gdg-agent/);

    // spawn-slot
    const spawnScript = await readFile(join(prefix, "opt/custom-agent/bin/spawn-slot-0"), "utf8");
    assert.match(spawnScript, /PATH="\/opt\/custom-agent\/bin:\/usr\/bin:\/bin"/);
    assert.match(spawnScript, /cp \/opt\/custom-agent\/lib\/cli-config\.json/);
    assert.match(spawnScript, /exec \/usr\/bin\/node \/opt\/custom-agent\/lib\/exec-spawn\.ts/);

    // sandbox.json
    const sandbox = JSON.parse(
      await readFile(join(prefix, "home/gdgagent-run-0/.cursor/sandbox.json"), "utf8"),
    );
    assert.ok(sandbox.additionalReadonlyPaths.includes("/opt/custom-agent/lib"));
    assert.ok(sandbox.additionalReadonlyPaths.includes("/opt/custom-agent/bin"));
    assert.ok(sandbox.additionalReadonlyPaths.includes("/run/custom-agent/0"));
    assert.ok(!sandbox.additionalReadonlyPaths.includes("/opt/gdg-agent/lib"));

    // mcp.json
    const mcp = JSON.parse(
      await readFile(join(prefix, "home/gdgagent-run-0/.cursor/mcp.json"), "utf8"),
    );
    assert.equal(mcp.mcpServers["gdg-index"].command, "/opt/custom-agent/bin/index-proxy");
    assert.equal(
      mcp.mcpServers["gdg-index"].env.AGENTS_INDEX_SOCKET,
      "/run/custom-agent/0/index.sock",
    );

    // hooks.json
    const hooks = JSON.parse(
      await readFile(join(prefix, "home/gdgagent-run-0/.cursor/hooks.json"), "utf8"),
    );
    assert.match(hooks.hooks.preToolUse[0].command, /\/opt\/custom-agent\/lib\/acl-gate\.ts/);

    // cli-config.json
    const cliConfig = JSON.parse(
      await readFile(join(prefix, "home/gdgagent-run-0/.cursor/cli-config.json"), "utf8"),
    );
    assert.ok(cliConfig.permissions.allow.includes("Shell(/opt/custom-agent/bin/wk)"));
    assert.ok(cliConfig.permissions.allow.includes("Shell(/opt/custom-agent/bin/gws)"));
  } finally {
    await rm(prefix, { recursive: true, force: true });
    await rm(customSpecDir, { recursive: true, force: true });
  }
});

test("rejects unsupported backend values in schema and agent-host apply", async () => {
  const customSpecDir = await mkdtemp(join(tmpdir(), "gdg-agent-bad-backend-"));
  try {
    const baseSpec = JSON.parse(
      await readFile(join(repositoryRoot, "agent-host/agent-host.json"), "utf8"),
    );
    const unknownBackendSpec = {
      ...baseSpec,
      backend: {
        name: "unknown-llm",
        model: "composer-2.5",
        isolation: {
          slotLauncher: true,
          osSandbox: "workspace",
          toolGate: "preToolUse-failClosed",
        },
      },
    };
    const unknownSpecPath = join(customSpecDir, "unknown-backend.json");
    await writeFile(unknownSpecPath, JSON.stringify(unknownBackendSpec, null, 2), "utf8");

    // Schema validation must reject unknown-llm
    const ajvCheck = spawnSync(
      "npx",
      [
        "ajv-cli",
        "validate",
        "-s",
        join(repositoryRoot, "agent-host/agent-host.schema.json"),
        "-d",
        unknownSpecPath,
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(ajvCheck.status, 0);

    // agent-host apply must fail closed on unknown backend
    const applyCheckUnknown = applyLayout(
      {
        ...process.env,
        GDG_SPEC: unknownSpecPath,
        GDG_SETUP_PREFIX: "/tmp/fake-prefix",
      },
      ["--dry-run"],
    );
    assert.notEqual(applyCheckUnknown.status, 0);
    assert.match(applyCheckUnknown.stderr, /unknown backend/);

    // Schema validation must reject missing isolation
    const missingIsolationSpec = {
      ...baseSpec,
      backend: {
        name: "cursor",
        model: "composer-2.5",
      },
    };
    const missingIsoPath = join(customSpecDir, "missing-iso.json");
    await writeFile(missingIsoPath, JSON.stringify(missingIsolationSpec, null, 2), "utf8");
    const ajvIsoCheck = spawnSync(
      "npx",
      [
        "ajv-cli",
        "validate",
        "-s",
        join(repositoryRoot, "agent-host/agent-host.schema.json"),
        "-d",
        missingIsoPath,
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(ajvIsoCheck.status, 0);

    // agent-host apply must fail closed on antigravity because it lacks 3 layers
    const antigravitySpec = {
      ...baseSpec,
      backend: {
        name: "antigravity",
        model: "gemini-2.5",
        isolation: {
          slotLauncher: true,
          osSandbox: "workspace",
          toolGate: "preToolUse-failClosed",
        },
      },
    };
    const antigravityPath = join(customSpecDir, "antigravity.json");
    await writeFile(antigravityPath, JSON.stringify(antigravitySpec, null, 2), "utf8");
    const applyCheckAntigravity = applyLayout(
      {
        ...process.env,
        GDG_SPEC: antigravityPath,
        GDG_SETUP_PREFIX: "/tmp/fake-prefix",
      },
      ["--dry-run"],
    );
    assert.notEqual(applyCheckAntigravity.status, 0);
    assert.match(applyCheckAntigravity.stderr, /does not satisfy required isolation/);
    // Stage 12 lifted slot isolation into CliRunnerBase for all xangi adapters, so slotLauncher
    // is now satisfied for antigravity too — it must not appear in the failure output any more.
    // Stage 14 (ADR-032) implemented the toolGate mechanism (acl-gate.ts reuse via a root-owned
    // per-slot hooks.json) and end-to-end verified it against an unpinned agy build, but its
    // code-review follow-up requires a pinned+checksummed agy version and an E2E test against
    // that exact binary before the registry may claim the guarantee — so toolGate (alongside
    // osSandbox, unverified boundary equivalence) still blocks the switch here.
    assert.doesNotMatch(applyCheckAntigravity.stderr, /slotLauncher/);
    assert.match(applyCheckAntigravity.stderr, /toolGate/);
    assert.match(applyCheckAntigravity.stderr, /osSandbox/);
  } finally {
    await rm(customSpecDir, { recursive: true, force: true });
  }
});

test("spec node pin strictly enforces pinned Node minor version", async () => {
  const customSpecDir = await mkdtemp(join(tmpdir(), "gdg-agent-node-pin-"));
  try {
    const baseSpec = JSON.parse(
      await readFile(join(repositoryRoot, "agent-host/agent-host.json"), "utf8"),
    );
    const currentMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
    const highMinorSpec = {
      ...baseSpec,
      pins: {
        ...baseSpec.pins,
        node: {
          major: currentMajor,
          minMinor: 999,
        },
      },
    };
    const highMinorSpecPath = join(customSpecDir, "agent-host.json");
    await writeFile(highMinorSpecPath, JSON.stringify(highMinorSpec, null, 2), "utf8");

    const check = applyLayout(
      {
        ...process.env,
        GDG_SPEC: highMinorSpecPath,
        GDG_SETUP_PREFIX: "",
      },
      ["--dry-run"],
    );
    assert.notEqual(check.status, 0);
  } finally {
    await rm(customSpecDir, { recursive: true, force: true });
  }
});

test("validate-spec command and build-agent-host-release enforce release gating", async () => {
  const { validateSpecForPublish } = await import("../../scripts/build-agent-host-release.mjs");
  const bin = ensureGdgBin();

  // 1. Default spec is production and satisfies validate-spec --for-release
  const prodCheck = spawnSync(
    bin,
    ["agent-host", "validate-spec", "--for-release", "--spec", defaultSpec],
    {
      encoding: "utf8",
    },
  );
  assert.equal(prodCheck.status, 0, prodCheck.stderr || prodCheck.stdout);

  // 2. Development spec passes validate-spec but is rejected by --for-release and publish gate
  const customSpecDir = await mkdtemp(join(tmpdir(), "gdg-agent-dev-spec-"));
  try {
    const baseSpec = JSON.parse(await readFile(defaultSpec, "utf8"));
    const devSpec = {
      ...baseSpec,
      environment: "development",
      backend: {
        name: "antigravity",
        model: "gemini-2.5",
        isolation: {
          slotLauncher: false,
          osSandbox: "none",
          toolGate: "none",
        },
      },
    };
    const devSpecPath = join(customSpecDir, "dev-spec.json");
    const devSpecContent = JSON.stringify(devSpec, null, 2);
    await writeFile(devSpecPath, devSpecContent, "utf8");

    // Local validation succeeds
    const localCheck = spawnSync(bin, ["agent-host", "validate-spec", "--spec", devSpecPath], {
      encoding: "utf8",
    });
    assert.equal(localCheck.status, 0, localCheck.stderr || localCheck.stdout);

    // Release validation gate fails
    const releaseCheck = spawnSync(
      bin,
      ["agent-host", "validate-spec", "--for-release", "--spec", devSpecPath],
      { encoding: "utf8" },
    );
    assert.notEqual(releaseCheck.status, 0);
    assert.match(releaseCheck.stderr, /cannot be published/);

    // scripts/build-agent-host-release.mjs validateSpecForPublish rejects dev spec
    assert.throws(() => {
      validateSpecForPublish(devSpecPath, devSpecContent, bin);
    }, /cannot be published/);

    // 3. A spec that OMITS "environment" entirely must be rejected for release, not silently
    // defaulted to production -- distinguishing this from an explicit "production" spec is only
    // possible against the raw JSON, before ordinary spec loading defaults the omission away.
    const { environment: _omitted, ...specWithoutEnvironment } = baseSpec;
    const noEnvPath = join(customSpecDir, "no-environment-spec.json");
    const noEnvContent = JSON.stringify(specWithoutEnvironment, null, 2);
    await writeFile(noEnvPath, noEnvContent, "utf8");

    // Ordinary (non-release) validation still accepts the omission (defaults to production).
    const noEnvLocalCheck = spawnSync(bin, ["agent-host", "validate-spec", "--spec", noEnvPath], {
      encoding: "utf8",
    });
    assert.equal(noEnvLocalCheck.status, 0, noEnvLocalCheck.stderr || noEnvLocalCheck.stdout);

    // Release validation gate rejects the omission.
    const noEnvReleaseCheck = spawnSync(
      bin,
      ["agent-host", "validate-spec", "--for-release", "--spec", noEnvPath],
      { encoding: "utf8" },
    );
    assert.notEqual(noEnvReleaseCheck.status, 0);
    assert.match(noEnvReleaseCheck.stderr, /environment.*required/i);

    // scripts/build-agent-host-release.mjs validateSpecForPublish rejects the omission too.
    assert.throws(() => {
      validateSpecForPublish(noEnvPath, noEnvContent, bin);
    }, /environment/i);
  } finally {
    await rm(customSpecDir, { recursive: true, force: true });
  }
});
