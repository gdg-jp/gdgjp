import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildRelease, validateSpecForPublish } from "../../scripts/build-agent-host-release.mjs";

const MINIMAL_SPEC = {
  environment: "production",
  slotCount: 1,
  backend: { name: "cursor", model: "composer-2.5", isolation: {} },
  discord: { showThinking: false, streaming: false, completionNotify: "off" },
  pins: {},
  paths: {
    agentRoot: "/opt/gdg-agent",
    workspace: "/srv/gdg-agent/wiki",
    runRoot: "/run/gdg-agent",
  },
};

async function withFixtureDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "gdg-release-fixture-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("buildRelease refuses to bundle a credentials.json under config/", async () => {
  await withFixtureDir(async (dir) => {
    const specPath = join(dir, "agent-host.json");
    await writeFile(specPath, JSON.stringify(MINIMAL_SPEC, null, 2), "utf8");
    await mkdir(join(dir, "config"), { recursive: true });
    await writeFile(join(dir, "config", "credentials.json"), "{}", "utf8");
    await mkdir(join(dir, "workspace"), { recursive: true });

    const outDir = join(dir, "out");
    await assert.rejects(
      buildRelease({ specPath, outDir, allowEphemeralKey: true, version: "1.0.0" }),
      /sensitive/i,
    );
  });
});

test("buildRelease refuses to bundle a .dev.vars file under workspace/", async () => {
  await withFixtureDir(async (dir) => {
    const specPath = join(dir, "agent-host.json");
    await writeFile(specPath, JSON.stringify(MINIMAL_SPEC, null, 2), "utf8");
    await mkdir(join(dir, "config"), { recursive: true });
    await mkdir(join(dir, "workspace"), { recursive: true });
    await writeFile(join(dir, "workspace", ".dev.vars"), "SECRET=1", "utf8");

    const outDir = join(dir, "out");
    await assert.rejects(
      buildRelease({ specPath, outDir, allowEphemeralKey: true, version: "1.0.0" }),
      /sensitive/i,
    );
  });
});

test("buildRelease succeeds and emits archive, manifest, sig, and latest.txt for a clean tree", async () => {
  await withFixtureDir(async (dir) => {
    const specPath = join(dir, "agent-host.json");
    await writeFile(specPath, JSON.stringify(MINIMAL_SPEC, null, 2), "utf8");
    await mkdir(join(dir, "config"), { recursive: true });
    await writeFile(join(dir, "config", "hooks.json"), "{}", "utf8");
    await mkdir(join(dir, "workspace"), { recursive: true });
    await writeFile(join(dir, "workspace", "AGENTS.md"), "# guidance", "utf8");

    const outDir = join(dir, "out");
    const result = await buildRelease({
      specPath,
      outDir,
      allowEphemeralKey: true,
      version: "9.9.9",
    });

    const latest = await readFile(result.latestPointerPath, "utf8");
    assert.equal(latest.trim(), "9.9.9");
    assert.equal(result.manifest.version, "9.9.9");
    assert.equal(result.manifest.type, "release");
    assert.ok(result.manifest.entries["agent-host.json"]);
    assert.ok(result.manifest.entries["config/hooks.json"]);
    assert.ok(result.manifest.entries["workspace/AGENTS.md"]);
  });
});

test("validateSpecForPublish rejects a spec omitting environment, distinct from an explicit value", () => {
  const withEnv = { ...MINIMAL_SPEC };
  assert.doesNotThrow(() => validateSpecForPublish("spec.json", JSON.stringify(withEnv)));

  const { environment: _omitted, ...withoutEnv } = MINIMAL_SPEC;
  assert.throws(
    () => validateSpecForPublish("spec.json", JSON.stringify(withoutEnv)),
    /missing required field "environment"/,
  );
});

test("validateSpecForPublish rejects environment: development", () => {
  const devSpec = { ...MINIMAL_SPEC, environment: "development" };
  assert.throws(
    () => validateSpecForPublish("spec.json", JSON.stringify(devSpec)),
    /cannot be published/,
  );
});
