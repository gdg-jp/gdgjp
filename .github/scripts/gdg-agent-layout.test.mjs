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
    assert.deepEqual(Object.keys(mcp.mcpServers), ["gdg-index"]);
    assert.equal(
      mcp.mcpServers["gdg-index"].env.AGENTS_INDEX_SOCKET,
      "/run/gdg-agent/2/index.sock",
    );

    const launcher = await readFile(join(prefix, "opt/gdg-agent/bin/spawn-slot-1"), "utf8");
    assert.match(launcher, /takes no arguments/);
    assert.match(launcher, /SLOT="1"/);
    assert.match(launcher, /PATH="\/opt\/gdg-agent\/bin:\/usr\/bin:\/bin"/);

    const cursorDir = await stat(join(prefix, "home/gdgagent-run-0/.cursor"));
    assert.equal(cursorDir.isDirectory(), true);
    assert.equal(cursorDir.isSymbolicLink(), false);

    const wk = await stat(join(prefix, "opt/gdg-agent/bin/wk"));
    assert.equal(wk.mode & 0o111, 0o111);

    const wiki = await stat(join(prefix, "srv/gdg-agent/wiki"));
    assert.equal(wiki.mode & 0o7777, 0o2770);

    const sudoersAgain = await readFile(join(prefix, "etc/sudoers.d/gdg-agent"), "utf8");
    assert.match(sudoersAgain, /pkill -KILL -u gdgagent-run-0$/m);

    for (const name of ["hooks.json", "cli-config.json", "sandbox.json", "mcp.json"]) {
      const info = await stat(join(prefix, "home/gdgagent-run-0/.cursor", name));
      assert.equal(info.mode & 0o777, 0o444, name);
    }
    const libHook = await stat(join(prefix, "opt/gdg-agent/lib/wk.ts"));
    assert.equal(libHook.mode & 0o777, 0o444);

    const execSpawn = await readFile(join(prefix, "opt/gdg-agent/lib/exec-spawn.ts"), "utf8");
    assert.match(execSpawn, /"--mcp-config", `\$\{home\}\/\.cursor\/mcp\.json`/);
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
    const wk = await stat(join(prefix, "opt/gdg-agent/bin/wk"));
    assert.equal(wk.mode & 0o111, 0o111);

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
