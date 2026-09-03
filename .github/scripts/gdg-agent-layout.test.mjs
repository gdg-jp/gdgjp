import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const layoutScript = join(repositoryRoot, "agent-host/lib/install-layout.sh");
const hooksSrc = join(repositoryRoot, "cli/internal/wiki/hooks");
const ownershipScript = join(repositoryRoot, "agent-host/lib/apply-ownership.sh");
const hostInstall = join(repositoryRoot, "agent-host/install.sh");

async function withLayoutFixture(run) {
  const prefix = await mkdtemp(join(tmpdir(), "gdg-agent-layout-"));
  const hooksDir = await mkdtemp(join(tmpdir(), "gdg-agent-hooks-"));
  try {
    await cp(hooksSrc, hooksDir, { recursive: true });
    await writeFile(join(hooksDir, "acl.ts"), "export {};\n", "utf8");
    const env = {
      ...process.env,
      GDG_SETUP_PREFIX: prefix,
      GDG_SETUP_HOOKS_SRC: hooksDir,
      GDG_SETUP_INDEX_PROXY_SRC: join(repositoryRoot, "agents-index/src/proxy.ts"),
      GDG_AGENT_SLOT_COUNT: "4",
    };
    const result = spawnSync("bash", [layoutScript], { encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await run({ prefix, env });
  } finally {
    await rm(prefix, { recursive: true, force: true });
    await rm(hooksDir, { recursive: true, force: true });
  }
}

test("agent layout is idempotent, root-owned templates, and has no sudoers wildcards", async () => {
  const ownership = await readFile(ownershipScript, "utf8");
  assert.match(ownership, /\.config\/cursor/);
  assert.doesNotMatch(ownership, /\.google_workspace_mcp/);
  assert.match(ownership, /\.cache/);
  assert.match(ownership, /install -d -m 0700 -o "gdgagent-run-\$\{slot\}"/);
  await withLayoutFixture(async ({ prefix, env }) => {
    const staleWrapper = join(prefix, "opt/gdg-agent/bin/google-workspace-mcp");
    await writeFile(staleWrapper, "#!/bin/sh\necho stale\n", { mode: 0o755 });

    const again = spawnSync("bash", [layoutScript], { encoding: "utf8", env });
    assert.equal(again.status, 0, again.stderr || again.stdout);
    assert.equal(
      existsSync(staleWrapper),
      false,
      "install-layout.sh must remove wrappers left over from superseded designs",
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

test("host install.sh prefix mode writes layout; live mode is Ubuntu-only", async () => {
  const prefix = await mkdtemp(join(tmpdir(), "gdg-agent-install-"));
  const hooksDir = await mkdtemp(join(tmpdir(), "gdg-agent-install-hooks-"));
  try {
    await cp(hooksSrc, hooksDir, { recursive: true });
    await writeFile(join(hooksDir, "acl.ts"), "export {};\n", "utf8");
    const env = {
      ...process.env,
      GDG_SETUP_PREFIX: prefix,
      GDGJP_ROOT: repositoryRoot,
      GDG_SKIP_CLONE: "1",
      GDG_SKIP_BUILD: "1",
      GDG_SETUP_HOOKS_SRC: hooksDir,
      GDG_SETUP_INDEX_PROXY_SRC: join(repositoryRoot, "agents-index/src/proxy.ts"),
      GDG_AGENT_SLOT_COUNT: "4",
    };
    const result = spawnSync("bash", [hostInstall], { encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /gdgjp checkout/);
    const installSrc = await readFile(hostInstall, "utf8");
    assert.match(installSrc, /groupadd --system gdgagent-svc/);
    assert.match(installSrc, /--gid gdgagent-svc/);
    assert.doesNotMatch(installSrc, /useradd.*--gid gdgwiki.*gdgagent-svc/);
    const wk = await stat(join(prefix, "opt/gdg-agent/bin/wk"));
    assert.equal(wk.mode & 0o111, 0o111);

    const wikiMcp = await readFile(join(prefix, "srv/gdg-agent/wiki/.cursor/mcp.json"), "utf8");
    const sourceMcp = await readFile(
      join(repositoryRoot, "agent-host/config/extra-mcp.json"),
      "utf8",
    );
    assert.equal(wikiMcp, sourceMcp);
    const localMdc = await readFile(
      join(prefix, "srv/gdg-agent/wiki/.cursor/rules/local.mdc"),
      "utf8",
    );
    const agentsMd = await readFile(join(repositoryRoot, "agent-host/workspace/AGENTS.md"), "utf8");
    assert.equal(localMdc, `---\nalwaysApply: true\n---\n\n${agentsMd}`);
    assert.match(installSrc, /gdg wiki clone/);
    assert.match(installSrc, /\/usr\/local\/bin\/gdg/);
    assert.match(installSrc, /Harineko0\/xangi/);
    assert.match(installSrc, /ensure_gws/);
    assert.match(installSrc, /ensure_cursor_cli/);
    assert.match(installSrc, /ensure_gdg_system/);
    assert.doesNotMatch(installSrc, /releases\/latest/);
    assert.doesNotMatch(installSrc, /setup-ai-tools\.sh/);
    assert.match(installSrc, /downloads\.cursor\.com/);
    assert.doesNotMatch(installSrc, /ensure_uv\b/);
    assert.doesNotMatch(installSrc, /uvx/);
    assert.match(installSrc, /gws did not install correctly/);
    assert.match(installSrc, /Environment=AGENT_MODEL=\$\{AGENT_MODEL\}/);

    const spec = JSON.parse(
      await readFile(join(repositoryRoot, "agent-host/agent-host.json"), "utf8"),
    );
    assert.equal(spec.slotCount, 4);
    assert.equal(spec.backend.model, "composer-2.5");
    assert.equal(spec.pins.cursorAgent.version, "2026.08.11-e8db854");
    assert.ok(spec.pins.cursorAgent.sha256.x86_64);
    assert.ok(spec.pins.cursorAgent.sha256.aarch64);
    assert.equal(spec.pins.gdgCli.version, "0.1.4");
    assert.equal(spec.pins.gdgCli.assetTemplate, "gdg_{version}_linux_{arch}.zip");
    assert.ok(spec.pins.gdgCli.sha256.x86_64);
    assert.ok(spec.pins.gdgCli.sha256.aarch64);
    assert.equal(spec.pins.xangi.ref, "b3db5919a5e33769ef8d7bcef245aa6b76974948");
    assert.equal(spec.pins.gws.version, "v0.22.5");
    assert.match(installSrc, /nodesource \$\{bootstrap_major\}\.x/);
    assert.match(installSrc, /GDG_CLI_ASSET_TEMPLATE/);

    const cliConfigSrc = await readFile(
      join(repositoryRoot, "agent-host/config/cli-config.json"),
      "utf8",
    );
    assert.doesNotMatch(cliConfigSrc, /google-workspace/);
    assert.match(cliConfigSrc, /Shell\(gws\)/);
    assert.match(cliConfigSrc, /Shell\(\/opt\/gdg-agent\/bin\/gws\)/);
    assert.match(installSrc, /npm ci failed; retrying once/);
    assert.match(installSrc, /\.local\/share\n/);
    assert.match(installSrc, /setup --apply/);
    assert.match(installSrc, /cd "\$HOME" && exec/);
    assert.match(installSrc, /chmod -R a\+rX node_modules/);
    assert.match(installSrc, /--activate/);
    assert.match(installSrc, /activate_live_host/);
    assert.match(installSrc, /place_live_host/);
    assert.match(installSrc, /cp -a "\$layout_dir\/langfuse-forwarder" \/opt\/langfuse-forwarder/);
    assert.doesNotMatch(installSrc, /"\$layout_dir\/lib\/langfuse-forwarder"/);
    assert.match(installSrc, /sudo \.\/agent-host\/install\.sh/);
    assert.doesNotMatch(installSrc, /sudo \.\/agents-local\/install\.sh/);
    assert.equal(
      existsSync(join(repositoryRoot, "agent-host/langfuse-forwarder/package-lock.json")),
      true,
      "agent-host/langfuse-forwarder must retain package-lock.json for deterministic npm ci",
    );
    assert.equal(
      existsSync(join(repositoryRoot, "agent-host/setup.sh")),
      false,
      "agent-host/setup.sh must be removed; 13 checks are in lib/verify.sh",
    );
    assert.equal(
      existsSync(join(repositoryRoot, "agent-host/lib/verify.sh")),
      true,
      "agent-host/lib/verify.sh must exist as the retreat home for the 13 verification checks",
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
    assert.doesNotMatch(installSrc, /iam\.json/);
    const limaConfig = await readFile(
      join(repositoryRoot, "agent-host/dev/lima-gdg-agent.yaml"),
      "utf8",
    );
    assert.match(limaConfig, /mountPoint: \/mnt\/xangi-src/);
    assert.equal(
      existsSync(join(prefix, "srv/gdg-agent/wiki/.agents/skills/wiki-ingest/SKILL.md")),
      true,
    );

    const liveEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key !== "GDG_SETUP_PREFIX"),
    );
    const live = spawnSync("bash", [hostInstall], { encoding: "utf8", env: liveEnv });
    if (process.platform !== "linux") {
      assert.notEqual(live.status, 0);
      assert.match(`${live.stderr}${live.stdout}`, /Ubuntu only/);
    }
  } finally {
    await rm(prefix, { recursive: true, force: true });
    await rm(hooksDir, { recursive: true, force: true });
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
  const hooksDir = await mkdtemp(join(tmpdir(), "gdg-agent-hooks-"));
  const specDir = await mkdtemp(join(tmpdir(), "gdg-agent-spec-"));
  try {
    await cp(hooksSrc, hooksDir, { recursive: true });
    await writeFile(join(hooksDir, "acl.ts"), "export {};\n", "utf8");
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
      GDG_SETUP_HOOKS_SRC: hooksDir,
      GDG_SETUP_INDEX_PROXY_SRC: join(repositoryRoot, "agents-index/src/proxy.ts"),
    };

    const result = spawnSync("bash", [layoutScript], { encoding: "utf8", env });
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
  } finally {
    await rm(prefix, { recursive: true, force: true });
    await rm(hooksDir, { recursive: true, force: true });
    await rm(specDir, { recursive: true, force: true });
  }
});

test("validate-then-rename preserves existing sudoers if validation fails", async () => {
  const prefix = await mkdtemp(join(tmpdir(), "gdg-agent-sudoers-fail-"));
  const hooksDir = await mkdtemp(join(tmpdir(), "gdg-agent-hooks-"));
  const fakeBinDir = await mkdtemp(join(tmpdir(), "fake-bin-"));
  try {
    await cp(hooksSrc, hooksDir, { recursive: true });
    await writeFile(join(hooksDir, "acl.ts"), "export {};\n", "utf8");
    const sudoersDir = join(prefix, "etc/sudoers.d");
    const sudoersFile = join(sudoersDir, "gdg-agent");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(sudoersDir, { recursive: true });
    const originalContent = "# ORIGINAL LIVE SUDOERS CONTENT\n";
    await writeFile(sudoersFile, originalContent, { mode: 0o440 });

    // Mock visudo on PATH to simulate syntax failure
    const fakeVisudo = join(fakeBinDir, "visudo");
    await writeFile(fakeVisudo, "#!/bin/sh\necho 'simulated syntax error' >&2\nexit 1\n", {
      mode: 0o755,
    });

    const env = {
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH}`,
      GDG_SETUP_PREFIX: prefix,
      GDG_SETUP_HOOKS_SRC: hooksDir,
      GDG_SETUP_INDEX_PROXY_SRC: join(repositoryRoot, "agents-index/src/proxy.ts"),
      GDG_AGENT_SLOT_COUNT: "4",
    };

    const result = spawnSync("bash", [layoutScript], { encoding: "utf8", env });
    assert.notEqual(result.status, 0, "layout script must fail when visudo validation fails");

    const contentAfterFailure = await readFile(sudoersFile, "utf8");
    assert.equal(
      contentAfterFailure,
      originalContent,
      "Existing live sudoers file must remain unchanged on validation failure",
    );
  } finally {
    await rm(prefix, { recursive: true, force: true });
    await rm(hooksDir, { recursive: true, force: true });
    await rm(fakeBinDir, { recursive: true, force: true });
  }
});

test("agent-host/lib/verify.sh exits 0 in prefix mode and contains 13 check assertions", async () => {
  const verifyScript = join(repositoryRoot, "agent-host/lib/verify.sh");
  const result = spawnSync("bash", [verifyScript], {
    encoding: "utf8",
    env: { ...process.env, GDG_SETUP_PREFIX: "/tmp/fake-prefix" },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /prefix mode active/);

  const verifySrc = await readFile(verifyScript, "utf8");
  assert.match(verifySrc, /credentials\.json/);
  assert.match(verifySrc, /\/srv\/gdg-agent\/wiki/);
  assert.match(verifySrc, /authz\.sock/);
  assert.match(verifySrc, /bin\/wk/);
  assert.match(verifySrc, /lib\/wk\.ts/);
  assert.match(verifySrc, /package\.json/);
  assert.match(verifySrc, /\.cursor\/projects/);
  assert.match(verifySrc, /\.cursor\/mcp\.json/);
  assert.match(verifySrc, /\.cursor\/cli-config\.json/);
  assert.match(verifySrc, /\.cursor\/sandbox\.json/);
  assert.match(verifySrc, /\.cursor\/hooks\.json/);
  assert.match(verifySrc, /dataDir must not live under the wiki worktree/);
  assert.match(verifySrc, /conversation logs must not live under the wiki worktree/);
});

test("installer and layout fail closed on missing or malformed spec", async () => {
  const prefix = await mkdtemp(join(tmpdir(), "gdg-agent-fail-closed-"));
  const badSpecDir = await mkdtemp(join(tmpdir(), "gdg-agent-bad-spec-"));
  try {
    const missingSpecPath = join(badSpecDir, "nonexistent.json");
    const missingSpecResult = spawnSync("bash", [layoutScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        GDG_SPEC: missingSpecPath,
        GDG_SETUP_PREFIX: prefix,
      },
    });
    assert.notEqual(missingSpecResult.status, 0);
    assert.match(missingSpecResult.stderr, /spec file not found/);

    const malformedSpecPath = join(badSpecDir, "malformed.json");
    await writeFile(malformedSpecPath, "{ invalid json", "utf8");
    const malformedResult = spawnSync("bash", [layoutScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        GDG_SPEC: malformedSpecPath,
        GDG_SETUP_PREFIX: prefix,
      },
    });
    assert.notEqual(malformedResult.status, 0);
    assert.match(malformedResult.stderr, /Failed to parse spec/);

    const incompleteSpecPath = join(badSpecDir, "incomplete.json");
    await writeFile(incompleteSpecPath, JSON.stringify({ slotCount: 4 }), "utf8");
    const incompleteResult = spawnSync("bash", [layoutScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        GDG_SPEC: incompleteSpecPath,
        GDG_SETUP_PREFIX: prefix,
      },
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
  const hooksDir = await mkdtemp(join(tmpdir(), "gdg-agent-hooks-"));
  try {
    await cp(hooksSrc, hooksDir, { recursive: true });
    await writeFile(join(hooksDir, "acl.ts"), "export {};\n", "utf8");

    // First run: 4 slots
    const env4 = {
      ...process.env,
      GDG_SETUP_PREFIX: prefix,
      GDG_SETUP_HOOKS_SRC: hooksDir,
      GDG_SETUP_INDEX_PROXY_SRC: join(repositoryRoot, "agents-index/src/proxy.ts"),
      GDG_AGENT_SLOT_COUNT: "4",
    };
    const res4 = spawnSync("bash", [layoutScript], { encoding: "utf8", env: env4 });
    assert.equal(res4.status, 0, res4.stderr || res4.stdout);

    // Verify slot 3 exists
    assert.ok(existsSync(join(prefix, "opt/gdg-agent/bin/spawn-slot-3")));
    assert.ok(existsSync(join(prefix, "run/gdg-agent/3")));
    assert.ok(existsSync(join(prefix, "home/gdgagent-run-3/.cursor/sandbox.json")));

    // Second run: reduce to 3 slots
    const env3 = {
      ...process.env,
      GDG_SETUP_PREFIX: prefix,
      GDG_SETUP_HOOKS_SRC: hooksDir,
      GDG_SETUP_INDEX_PROXY_SRC: join(repositoryRoot, "agents-index/src/proxy.ts"),
      GDG_AGENT_SLOT_COUNT: "3",
    };
    const res3 = spawnSync("bash", [layoutScript], { encoding: "utf8", env: env3 });
    assert.equal(res3.status, 0, res3.stderr || res3.stdout);

    // Verify slot 3 is cleanly removed
    assert.ok(!existsSync(join(prefix, "opt/gdg-agent/bin/spawn-slot-3")));
    assert.ok(!existsSync(join(prefix, "run/gdg-agent/3")));
    assert.ok(!existsSync(join(prefix, "home/gdgagent-run-3/.cursor")));

    // Verify slot 2 remains
    assert.ok(existsSync(join(prefix, "opt/gdg-agent/bin/spawn-slot-2")));
    assert.ok(existsSync(join(prefix, "run/gdg-agent/2")));
    assert.ok(existsSync(join(prefix, "home/gdgagent-run-2/.cursor/sandbox.json")));

    // Verify sudoers and tmpfiles omit slot 3
    const sudoers = await readFile(join(prefix, "etc/sudoers.d/gdg-agent"), "utf8");
    assert.match(sudoers, /spawn-slot-2/);
    assert.doesNotMatch(sudoers, /spawn-slot-3/);

    const tmpfiles = await readFile(join(prefix, "etc/tmpfiles.d/gdg-agent.conf"), "utf8");
    assert.match(tmpfiles, /\/2 0750/);
    assert.doesNotMatch(tmpfiles, /\/3 0750/);
  } finally {
    await rm(prefix, { recursive: true, force: true });
    await rm(hooksDir, { recursive: true, force: true });
  }
});

test("spec paths govern all generated layout configurations", async () => {
  const prefix = await mkdtemp(join(tmpdir(), "gdg-agent-custom-paths-"));
  const hooksDir = await mkdtemp(join(tmpdir(), "gdg-agent-hooks-"));
  const customSpecDir = await mkdtemp(join(tmpdir(), "gdg-agent-custom-spec-"));
  try {
    await cp(hooksSrc, hooksDir, { recursive: true });
    await writeFile(join(hooksDir, "acl.ts"), "export {};\n", "utf8");

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
      GDG_SETUP_HOOKS_SRC: hooksDir,
      GDG_SETUP_INDEX_PROXY_SRC: join(repositoryRoot, "agents-index/src/proxy.ts"),
    };
    const res = spawnSync("bash", [layoutScript], { encoding: "utf8", env });
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
    await rm(hooksDir, { recursive: true, force: true });
    await rm(customSpecDir, { recursive: true, force: true });
  }
});

test("rejects unsupported backend values in schema and install.sh", async () => {
  const customSpecDir = await mkdtemp(join(tmpdir(), "gdg-agent-bad-backend-"));
  try {
    const baseSpec = JSON.parse(
      await readFile(join(repositoryRoot, "agent-host/agent-host.json"), "utf8"),
    );
    const badBackendSpec = {
      ...baseSpec,
      backend: {
        name: "antigravity",
        model: "composer-2.5",
      },
    };
    const badSpecPath = join(customSpecDir, "agent-host.json");
    await writeFile(badSpecPath, JSON.stringify(badBackendSpec, null, 2), "utf8");

    // Schema validation must reject antigravity
    const ajvCheck = spawnSync(
      "npx",
      [
        "ajv-cli",
        "validate",
        "-s",
        join(repositoryRoot, "agent-host/agent-host.schema.json"),
        "-d",
        badSpecPath,
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(ajvCheck.status, 0);

    // install.sh must fail closed on unsupported backend
    const installCheck = spawnSync("bash", [hostInstall, "--verify"], {
      encoding: "utf8",
      env: {
        ...process.env,
        GDG_SPEC: badSpecPath,
        GDG_SETUP_PREFIX: "/tmp/fake-prefix",
      },
    });
    assert.notEqual(installCheck.status, 0);
    assert.match(installCheck.stderr, /Unsupported backend/);
  } finally {
    await rm(customSpecDir, { recursive: true, force: true });
  }
});

test("node_ok strictly enforces pinned Node minor version in alternate modes", async () => {
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

    // install.sh --verify must fail because current Node is < currentMajor.999
    const check = spawnSync("bash", [hostInstall, "--verify"], {
      encoding: "utf8",
      env: {
        ...process.env,
        GDG_SPEC: highMinorSpecPath,
        GDG_SETUP_PREFIX: "/tmp/fake-prefix",
      },
    });
    assert.notEqual(check.status, 0);
  } finally {
    await rm(customSpecDir, { recursive: true, force: true });
  }
});
