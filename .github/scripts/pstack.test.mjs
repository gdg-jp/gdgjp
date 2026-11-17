import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkInstallation, ensureLink, setupInstallation } from "../../scripts/pstack.mjs";

function installation() {
  const root = mkdtempSync(join(tmpdir(), "pstack-install-"));
  for (const dir of ["pstack", "skills/example", "docs", "agents"]) {
    mkdirSync(join(root, ".agents", dir), { recursive: true });
  }
  writeFileSync(
    join(root, ".agents/pstack/manifest.json"),
    JSON.stringify({ skills: ["example"] }),
  );
  writeFileSync(
    join(root, ".agents/pstack/availability.json"),
    JSON.stringify({ models: ["gpt-6-astra"] }),
  );
  const source = fileURLToPath(new URL("../../.agents/pstack/models.mdc", import.meta.url));
  const config = readFileSync(source, "utf8").replaceAll(/: (?:claude|gpt)-[^\n]+/g, ": auto");
  writeFileSync(join(root, ".agents/pstack/models.mdc"), config);
  writeFileSync(join(root, ".agents/README.md"), "Installed guide");
  for (const agent of ["poteto-agent", "comment-sicko"]) {
    writeFileSync(join(root, ".agents/agents", `${agent}.md`), "Agent");
  }
  writeFileSync(
    join(root, ".agents/skills/example/SKILL.md"),
    "---\nname: example\ndescription: Example workflow\n---\n[Guide](../../README.md)\n",
  );
  setupInstallation(root);
  return root;
}

test("doctor validates links through every harness and catches a broken reference", () => {
  const root = installation();
  try {
    assert.deepEqual(checkInstallation(root).errors, []);
    rmSync(join(root, ".claude/README.md"));
    assert(
      checkInstallation(root).errors.some((error) => error.includes(".claude/example: unresolved")),
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("doctor rejects duplicate roles and models absent from the availability record", () => {
  const root = installation();
  try {
    const path = join(root, ".agents/pstack/models.mdc");
    writeFileSync(path, `${readFileSync(path, "utf8")}\nbug-fix: unknown-model\n`);
    const { errors } = checkInstallation(root);
    assert(errors.some((error) => error.includes("Expected one model entry for bug-fix")));
    assert(errors.some((error) => error.includes("Unconfirmed model unknown-model")));
  } finally {
    rmSync(root, { recursive: true });
  }
});

for (const harness of [".codex", ".claude", ".cursor"]) {
  test(`doctor rejects dangling skill discovery links in ${harness}`, () => {
    const root = installation();
    try {
      const directory = join(root, harness, "skills");
      mkdirSync(directory, { recursive: true });
      symlinkSync("missing-skill", join(directory, "obsolete"));
      assert(
        checkInstallation(root).errors.some((error) =>
          error.includes(`${harness}/skills/obsolete: dangling discovery link`),
        ),
      );
    } finally {
      rmSync(root, { recursive: true });
    }
  });
}

test("doctor allows project skills outside the manifest and a missing optional Codex directory", () => {
  const root = installation();
  try {
    assert.deepEqual(checkInstallation(root).errors, []);
    for (const harness of [".codex", ".claude", ".cursor"]) {
      const directory = join(root, harness, "skills");
      mkdirSync(directory, { recursive: true });
      symlinkSync(join(root, ".agents/skills/example"), join(directory, `${harness}-project`));
    }
    assert.deepEqual(checkInstallation(root).errors, []);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("setup restores a missing link and can run twice", () => {
  const root = mkdtempSync(join(tmpdir(), "pstack-links-"));
  try {
    writeFileSync(join(root, "source.md"), "approved models");
    ensureLink(root, "rules/models.md", "../source.md");
    ensureLink(root, "rules/models.md", "../source.md");
    assert.equal(readFileSync(join(root, "rules/models.md"), "utf8"), "approved models");
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("setup preserves an existing different file", () => {
  const root = mkdtempSync(join(tmpdir(), "pstack-links-"));
  try {
    writeFileSync(join(root, "source.md"), "new settings");
    writeFileSync(join(root, "models.md"), "existing settings");
    assert.throws(() => ensureLink(root, "models.md", "source.md"), /Preserving existing/);
    assert.equal(readFileSync(join(root, "models.md"), "utf8"), "existing settings");
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("setup refuses to overwrite an existing broken link", () => {
  const root = mkdtempSync(join(tmpdir(), "pstack-links-"));
  try {
    writeFileSync(join(root, "source.md"), "approved settings");
    symlinkSync("missing.md", join(root, "models.md"));
    assert.throws(() => ensureLink(root, "models.md", "source.md"), /Preserving existing/);
    writeFileSync(join(root, "missing.md"), "original link target");
    assert.equal(readFileSync(join(root, "models.md"), "utf8"), "original link target");
  } finally {
    rmSync(root, { recursive: true });
  }
});
