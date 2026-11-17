import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkDocumentation } from "../../scripts/check-docs.mjs";

const runner = fileURLToPath(new URL("../../scripts/check-docs.mjs", import.meta.url));

function fixture(action) {
  const root = mkdtempSync(join(tmpdir(), "gdg-docs-"));
  function write(path, text = "# Documentation\n") {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  for (const file of [
    "docs/README.md",
    "docs/plans/README.md",
    "docs/guides/README.md",
    "docs/references/README.md",
    "docs/archive/README.md",
  ]) {
    write(file);
  }
  try {
    action({ root, write });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("checks local inline links, images, reference definitions, and escaped paths", () => {
  fixture(({ root, write }) => {
    write("docs/guides/space name.md");
    write("docs/guides/figure (1).svg", "<svg/>");
    write(
      "docs/README.md",
      '[Guide](guides/space%20name.md#title)\n[Guide](guides/space\\ name.md)\n![Image](<guides/figure (1).svg> "figure")\n[Other](guides/figure\\ \\(1\\).svg)\n[ref]: guides/space%20name.md "Reference"\n',
    );
    assert.deepEqual(checkDocumentation(root), []);
    write(
      "docs/README.md",
      "[Broken](guides/missing.md)\n![Broken](missing.svg)\n[ref]: absent.md\n",
    );
    const errors = checkDocumentation(root);
    assert.equal(errors.length, 3);
    assert.ok(errors.some((error) => error.includes("docs/README.md:1:")));
    assert.ok(errors.some((error) => error.includes("missing.svg")));
    assert.ok(errors.some((error) => error.includes("absent.md")));
  });
});

test("ignores examples in fenced and inline code, external URLs and rooted product paths", () => {
  fixture(({ root, write }) => {
    write(
      "docs/README.md",
      [
        "```markdown",
        "[Example](missing.md)",
        "[example]: missing.md",
        "```",
        "~~~~markdown",
        "![Example](missing.png)",
        "~~~~",
        "`[Inline](missing.md)`",
        "[Remote](https://example.invalid/missing.md)",
        "[Mail](mailto:test@example.invalid)",
        "[Fragment](#heading)",
        "[Product](/api/pages)",
        "[Query](?search=page)",
      ].join("\n"),
    );
    assert.deepEqual(checkDocumentation(root), []);
  });
});

test("ignores historical archive links but validates its live navigation index", () => {
  fixture(({ root, write }) => {
    write("docs/archive/old/report.md", "[Old source](gone.ts:12)\n");
    assert.deepEqual(checkDocumentation(root), []);
    write("docs/archive/README.md", "[Missing report](absent.md)\n");
    assert.equal(checkDocumentation(root).length, 1);
  });
});

test("rejects unexpected root entries and missing entrypoints while ignoring OS junk", () => {
  fixture(({ root, write }) => {
    write("docs/.DS_Store", "junk");
    write("docs/._README.md", "junk");
    write("docs/Thumbs.db", "junk");
    assert.deepEqual(checkDocumentation(root), []);
    write("docs/random-plan.md");
    write("docs/old-topic/index.md");
    rmSync(join(root, "docs/plans/README.md"));
    const errors = checkDocumentation(root);
    assert.equal(errors.length, 3);
    assert.ok(errors.some((error) => error.includes("docs/random-plan.md:")));
    assert.ok(errors.some((error) => error.includes("docs/old-topic:")));
    assert.ok(errors.some((error) => error.includes("docs/plans/README.md:")));
  });
});

test("CLI reports a missing target with nonzero exit and accepts the repaired file", () => {
  fixture(({ root, write }) => {
    write("docs/README.md", "[Missing](guides/new.md)\n");
    const fail = spawnSync(process.execPath, [runner], { cwd: root, encoding: "utf8" });
    assert.equal(fail.status, 1);
    assert.match(fail.stderr, /docs\/README\.md:1: missing local target guides\/new\.md/);
    write("docs/guides/new.md");
    const pass = spawnSync(process.execPath, [runner], { cwd: root, encoding: "utf8" });
    assert.equal(pass.status, 0, pass.stderr);
  });
});

test("requires entrypoints to be files and reports malformed encoded local targets", () => {
  fixture(({ root, write }) => {
    rmSync(join(root, "docs/guides/README.md"));
    mkdirSync(join(root, "docs/guides/README.md"));
    write("docs/README.md", "[Malformed](bad%path.md)\n");
    const errors = checkDocumentation(root);
    assert.equal(errors.length, 2);
    assert.ok(errors.some((error) => error.includes("docs/guides/README.md:")));
    assert.ok(errors.some((error) => error.includes("invalid local target bad%path.md")));
  });
});
