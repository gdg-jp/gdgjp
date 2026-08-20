import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const installScript = join(repositoryRoot, "agents-index/install.sh");

test("agents-index/install.sh prefix mode writes launcher, db dir, and systemd unit", async () => {
  const prefix = await mkdtemp(join(tmpdir(), "agents-index-install-"));
  try {
    const env = {
      ...process.env,
      GDG_SETUP_PREFIX: prefix,
      GDGJP_ROOT: repositoryRoot,
      GDG_SKIP_BUILD: "1",
      GDG_SKIP_START: "1",
      GDG_AGENT_SLOT_COUNT: "4",
    };
    const result = spawnSync("bash", [installScript], { encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const launcher = join(prefix, "opt/gdg-agent/bin/agents-index");
    const launcherText = await readFile(launcher, "utf8");
    assert.match(launcherText, /\/usr\/bin\/node/);
    assert.match(launcherText, /agents-index\/src\/cli\.ts/);
    const launcherStat = await stat(launcher);
    assert.equal(launcherStat.mode & 0o111, 0o111);

    const dbDir = await stat(join(prefix, "var/lib/agents-index"));
    assert.equal(dbDir.isDirectory(), true);
    assert.equal(dbDir.mode & 0o777, 0o700);

    const unit = await readFile(join(prefix, "etc/systemd/system/agents-index.service"), "utf8");
    assert.match(unit, /^User=gdgagent-svc$/m);
    assert.match(
      unit,
      /SupplementaryGroups=gdgwiki gdgagent-run-0 gdgagent-run-1 gdgagent-run-2 gdgagent-run-3/,
    );
    assert.match(
      unit,
      /watch --root .*\/srv\/gdg-agent\/wiki --run-root .*\/run\/gdg-agent --slots 4/,
    );
    assert.match(unit, /HF_HOME=.*\/var\/lib\/agents-index\/hf/);
    assert.doesNotMatch(unit, /--authz-socket/);
  } finally {
    await rm(prefix, { recursive: true, force: true });
  }
});
