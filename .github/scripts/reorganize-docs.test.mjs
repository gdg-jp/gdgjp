import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../../scripts/reorganize-docs.mjs", import.meta.url));

function fixture(action) {
  const root = mkdtempSync(join(tmpdir(), "gdg-docs-move-"));
  const write = (path, contents) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  };
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "pipe" });
  write(
    "scripts/docs-moves.json",
    JSON.stringify({
      "docs/software-architecture.md": "docs/references/architecture.md",
      "docs/260518_auth_blog.md": "docs/archive/articles/auth.md",
      "docs/260518_auth_blog_images": "docs/archive/articles/images",
      "docs/pstack": "docs/archive/reports/pstack",
      "docs/plans/03a-agents-md.md": "docs/plans/knowledge-platform-v1/03a-agents-md.md",
    }),
  );
  const run = (...args) =>
    spawnSync(process.execPath, [runner, ...args], { cwd: root, encoding: "utf8" });
  const read = (path) => readFileSync(join(root, path));
  const snapshot = () => {
    const result = {};
    const walk = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === ".git") continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else result[relative(root, path)] = readFileSync(path).toString("base64");
      }
    };
    walk(root);
    return result;
  };
  try {
    action({ write, run, read, snapshot });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("migration moves Markdown and binary assets while preserving links and idempotency", () => {
  fixture(({ write, run, read, snapshot }) => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0xff]);
    write("docs/software-architecture.md", "# Architecture\n");
    write(
      "docs/260518_auth_blog.md",
      "# Article\n[Architecture](software-architecture.md#ownership)\n![Flow](260518_auth_blog_images/flow.png)\n",
    );
    write("docs/260518_auth_blog_images/flow.png", bytes);
    write("README.md", "[Architecture](docs/software-architecture.md)\n");
    write("scripts/consumer.mjs", 'const guide = "../docs/software-architecture.md";\n');
    const before = snapshot();
    const preview = run();
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /Planned [1-9]\d* file changes/);
    assert.deepEqual(snapshot(), before);
    const applied = run("--apply");
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(
      read("docs/archive/articles/auth.md").toString(),
      "# Article\n[Architecture](../../references/architecture.md#ownership)\n![Flow](images/flow.png)\n",
    );
    assert.deepEqual(read("docs/archive/articles/images/flow.png"), bytes);
    assert.equal(read("README.md").toString(), "[Architecture](docs/references/architecture.md)\n");
    assert.equal(
      read("scripts/consumer.mjs").toString(),
      'const guide = "../docs/references/architecture.md";\n',
    );
    assert.equal(snapshot()["docs/software-architecture.md"], undefined);
    const after = snapshot();
    const second = run("--apply");
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /Applied 0 file changes/);
    assert.deepEqual(snapshot(), after);
  });
});

test("destination collisions fail before changing any source file", () => {
  fixture(({ write, run, snapshot }) => {
    write("docs/software-architecture.md", "# Old location\n");
    write("docs/references/architecture.md", "# Existing target\n");
    write("README.md", "[Architecture](docs/software-architecture.md)\n");
    const before = snapshot();
    const result = run("--apply");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to replace docs\/references\/architecture\.md/);
    assert.deepEqual(snapshot(), before);
  });
});

test("root docs mapping leaves canonical agent workflow and relative agent links unchanged", () => {
  fixture(({ write, run, read }) => {
    const canonical = "# Repository pstack workflow\nUse the repository configuration.\n";
    const entry =
      "[Local workflow](docs/pstack.md)\nCanonical source: `.agents/docs/pstack.md`.\n[Setup record](../docs/pstack/setup.md)\n";
    write(".agents/docs/pstack.md", canonical);
    write(".agents/README.md", entry);
    write("docs/pstack/setup.md", "# Setup record\n");
    write("AGENTS.md", "Read `.agents/docs/pstack.md` and `docs/pstack/setup.md`.\n");
    const result = run("--apply");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(read(".agents/docs/pstack.md").toString(), canonical);
    assert.equal(
      read(".agents/README.md").toString(),
      entry.replace("../docs/pstack/setup.md", "../docs/archive/reports/pstack/setup.md"),
    );
    assert.equal(
      read("AGENTS.md").toString(),
      "Read `.agents/docs/pstack.md` and `docs/archive/reports/pstack/setup.md`.\n",
    );
    assert.equal(read("docs/archive/reports/pstack/setup.md").toString(), "# Setup record\n");
  });
});

test("moving a plan preserves its four-backtick Wiki seed with nested fenced Markdown", () => {
  fixture(({ write, run, read }) => {
    const seed =
      "````markdown\n# Wiki seed\n[Local page](./next.md)\n```markdown\n[nested page](./nested.md)\n```\n````";
    write(
      "docs/plans/03a-agents-md.md",
      `# Plan\n[Architecture](../software-architecture.md)\n${seed}\n`,
    );
    write("docs/software-architecture.md", "# Architecture\n");
    const unknownPlan = "# New plan\nThis plan has not been classified.\n";
    write("docs/plans/new-plan.md", unknownPlan);
    const result = run("--apply");
    assert.equal(result.status, 0, result.stderr);
    const moved = read("docs/plans/knowledge-platform-v1/03a-agents-md.md").toString();
    assert.equal(/````markdown\n([\s\S]*?)\n````/.exec(moved)?.[1], seed.slice(13, -5));
    assert.ok(moved.includes("[Architecture](../../references/architecture.md)"));
    assert.equal(read("docs/plans/new-plan.md").toString(), unknownPlan);
  });
});
