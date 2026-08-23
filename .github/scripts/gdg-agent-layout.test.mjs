import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const layoutScript = join(repositoryRoot, "scripts/gdg-agent/install-layout.sh");
const hooksSrc = join(repositoryRoot, "cli/internal/wiki/hooks");
const submoduleLayout = join(repositoryRoot, "agents-local/lib/install-layout.sh");
const ownershipScript = join(repositoryRoot, "agents-local/lib/apply-ownership.sh");
const hostInstall = join(repositoryRoot, "scripts/install-gdg-agent-host.sh");
const submoduleHostInstall = join(repositoryRoot, "agents-local/install.sh");

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
  if (existsSync(submoduleLayout)) {
    assert.equal(
      await readFile(layoutScript, "utf8"),
      await readFile(submoduleLayout, "utf8"),
      "scripts/gdg-agent/install-layout.sh must match agents-local/lib/install-layout.sh",
    );
  }
  if (existsSync(submoduleHostInstall)) {
    assert.equal(
      await readFile(hostInstall, "utf8"),
      await readFile(submoduleHostInstall, "utf8"),
      "scripts/install-gdg-agent-host.sh must match agents-local/install.sh",
    );
  }
  const ownership = await readFile(ownershipScript, "utf8");
  assert.match(ownership, /\.config\/cursor/);
  assert.match(ownership, /\.google_workspace_mcp\/credentials/);
  assert.match(ownership, /\.google_workspace_mcp\/logs/);
  assert.match(ownership, /\.cache/);
  assert.match(ownership, /install -d -m 0700 -o "gdgagent-run-\$\{slot\}"/);
  await withLayoutFixture(async ({ prefix, env }) => {
    const again = spawnSync("bash", [layoutScript], { encoding: "utf8", env });
    assert.equal(again.status, 0, again.stderr || again.stdout);

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
    assert.deepEqual(Object.keys(mcp.mcpServers), ["google-workspace", "gdg-index"]);
    assert.equal(
      mcp.mcpServers["google-workspace"].command,
      "/opt/gdg-agent/bin/google-workspace-mcp",
    );
    assert.equal(
      mcp.mcpServers["gdg-index"].env.AGENTS_INDEX_SOCKET,
      "/run/gdg-agent/2/index.sock",
    );

    const launcher = await readFile(join(prefix, "opt/gdg-agent/bin/spawn-slot-1"), "utf8");
    assert.match(launcher, /takes no arguments/);
    assert.match(launcher, /SLOT="1"/);
    assert.match(launcher, /PATH="\/opt\/gdg-agent\/bin:\/usr\/bin:\/bin"/);
    assert.match(launcher, /cp \/opt\/gdg-agent\/lib\/cli-config\.json/);
    const mcpWrapper = await readFile(
      join(prefix, "opt/gdg-agent/bin/google-workspace-mcp"),
      "utf8",
    );
    assert.match(mcpWrapper, /GOOGLE_OAUTH_CLIENT_SECRET/);
    assert.match(mcpWrapper, /\*\/bin\/workspace-mcp/);
    const permissions = JSON.parse(
      await readFile(join(prefix, "home/gdgagent-run-0/.cursor/permissions.json"), "utf8"),
    );
    assert.deepEqual(permissions.mcpAllowlist, ["google-workspace:search_drive_files"]);

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
    const sourceMcp = await readFile(join(repositoryRoot, "agents-local/.cursor/mcp.json"), "utf8");
    assert.equal(wikiMcp, sourceMcp);
    const localMdc = await readFile(
      join(prefix, "srv/gdg-agent/wiki/.cursor/rules/local.mdc"),
      "utf8",
    );
    const agentsMd = await readFile(join(repositoryRoot, "agents-local/AGENTS.md"), "utf8");
    assert.equal(localMdc, `---\nalwaysApply: true\n---\n\n${agentsMd}`);
    assert.match(installSrc, /gdg wiki clone/);
    assert.match(installSrc, /\/usr\/local\/bin\/gdg/);
    assert.match(installSrc, /Harineko0\/xangi/);
    assert.match(installSrc, /ensure_uv/);
    assert.match(installSrc, /UV_UNMANAGED_INSTALL=\/usr\/local\/bin/);
    assert.match(installSrc, /uvx is required for the google-workspace MCP/);
    assert.match(installSrc, /Environment=AGENT_MODEL=gpt-5\.3-codex-low/);
    const cliConfigSrc = await readFile(
      join(repositoryRoot, "agents-local/config/cli-config.json"),
      "utf8",
    );
    assert.match(cliConfigSrc, /Mcp\(google-workspace, search_drive_files\)/);
    assert.match(installSrc, /npm ci failed; retrying once/);
    assert.match(installSrc, /\.local\/share\n/);
    assert.match(installSrc, /setup --apply/);
    assert.match(installSrc, /cd "\$HOME" && exec/);
    assert.match(installSrc, /chmod -R a\+rX node_modules/);
    assert.match(installSrc, /--activate/);
    assert.match(installSrc, /activate_live_host/);
    assert.match(installSrc, /place_live_host/);
    const submoduleInstallSrc = await readFile(submoduleHostInstall, "utf8");
    assert.match(submoduleInstallSrc, /Environment=AGENT_MODEL=gpt-5\.3-codex-low/);
    const setupSrc = await readFile(join(repositoryRoot, "agents-local/setup.sh"), "utf8");
    assert.doesNotMatch(setupSrc, /gdg wiki clone wiki/);
    const provisionSrc = await readFile(
      join(repositoryRoot, "agents-local/dev/provision.sh"),
      "utf8",
    );
    assert.match(provisionSrc, /--exclude \/agents-local\/wiki/);
    assert.match(provisionSrc, /readonly xangi_source=\/mnt\/xangi-src/);
    assert.match(provisionSrc, /rsync -a --delete --exclude node_modules "\$xangi_source\/"/);
    assert.doesNotMatch(provisionSrc, /systemctl --user start/);
    const seedIam = join(repositoryRoot, "agents-local/dev/seed-iam.sh");
    const seedIamStat = await stat(seedIam);
    assert.equal(seedIamStat.mode & 0o111, 0o111);
    const seedIamSrc = await readFile(seedIam, "utf8");
    assert.doesNotMatch(seedIamSrc, /--activate|install\.sh/);
    assert.match(seedIamSrc, /0600/);
    assert.match(seedIamSrc, /gdgagent-svc/);
    assert.match(seedIamSrc, /\.gdgwiki\/config\.json/);
    assert.match(seedIamSrc, /not a wiki clone yet/);
    const configureGoogleWorkspace = join(
      repositoryRoot,
      "agents-local/dev/configure-google-workspace-mcp.sh",
    );
    const configureGoogleWorkspaceStat = await stat(configureGoogleWorkspace);
    assert.equal(configureGoogleWorkspaceStat.mode & 0o111, 0o111);
    const configureGoogleWorkspaceSrc = await readFile(configureGoogleWorkspace, "utf8");
    assert.match(configureGoogleWorkspaceSrc, /A TTY is required/);
    assert.match(configureGoogleWorkspaceSrc, /GOOGLE_OAUTH_REDIRECT_URI=http:\/\/localhost:/);
    assert.match(configureGoogleWorkspaceSrc, /install -m 0600/);
    const googleOAuthTunnel = join(
      repositoryRoot,
      "agents-local/dev/open-google-workspace-oauth-tunnel.sh",
    );
    const googleOAuthTunnelStat = await stat(googleOAuthTunnel);
    assert.equal(googleOAuthTunnelStat.mode & 0o111, 0o111);
    const googleOAuthTunnelSrc = await readFile(googleOAuthTunnel, "utf8");
    assert.match(googleOAuthTunnelSrc, /ssh -F/);
    assert.match(googleOAuthTunnelSrc, /127\.0\.0\.1:\$\{port\}:127\.0\.0\.1:\$\{port\}/);
    const iamFixture = await readFile(
      join(repositoryRoot, "agents-local/dev/iam-fixture.json"),
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
      join(repositoryRoot, "agents-local/dev/lima-gdg-agent.yaml"),
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
