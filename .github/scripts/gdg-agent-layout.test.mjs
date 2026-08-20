import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const layoutScript = join(repositoryRoot, "agents-local/lib/install-layout.sh");
const hooksSrc = join(repositoryRoot, "cli/internal/wiki/hooks");

async function installLayout() {
  const prefix = await mkdtemp(join(tmpdir(), "gdg-agent-layout-"));
  const result = spawnSync("bash", [layoutScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      GDG_SETUP_PREFIX: prefix,
      GDG_SETUP_HOOKS_SRC: hooksSrc,
      GDG_SETUP_INDEX_PROXY_SRC: join(repositoryRoot, "agents-index/src/proxy.ts"),
      GDG_AGENT_SLOT_COUNT: "4",
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return prefix;
}

test("agent layout is idempotent, root-owned templates, and has no sudoers wildcards", async () => {
  const prefix = await installLayout();
  try {
    const again = spawnSync("bash", [layoutScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        GDG_SETUP_PREFIX: prefix,
        GDG_SETUP_HOOKS_SRC: hooksSrc,
        GDG_SETUP_INDEX_PROXY_SRC: join(repositoryRoot, "agents-index/src/proxy.ts"),
        GDG_AGENT_SLOT_COUNT: "4",
      },
    });
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
  } finally {
    await rm(prefix, { recursive: true, force: true });
  }
});
