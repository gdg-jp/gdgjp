import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../../scripts/check-code-comments.mjs", import.meta.url));

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "gdg-comments-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: "pipe" });
  git("init", "-q");
  git("config", "user.name", "Comment test");
  git("config", "user.email", "comment-test@example.invalid");
  git("config", "core.hooksPath", "/dev/null");
  function write(path, text) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), text);
  }
  function commit() {
    git("add", ".");
    git("-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
    return git("rev-parse", "HEAD").trim();
  }
  write("file.tsx", "// existing legacy comment\nexport const value = 1;\n");
  commit();
  return {
    directory,
    git,
    write,
    commit,
    run: (...args) =>
      spawnSync(process.execPath, [runner, ...args], { cwd: directory, encoding: "utf8" }),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function withFixture(action) {
  const f = fixture();
  try {
    action(f);
  } finally {
    f.cleanup();
  }
}

test("working-tree gate rejects new or edited comments but accepts unchanged legacy comments and deletion", () => {
  withFixture((f) => {
    f.write("file.tsx", "// existing legacy comment\nexport const value = 2;\n");
    assert.equal(f.run().status, 0);
    f.write(
      "file.tsx",
      "// existing legacy comment\n// temporary workaround\nexport const value = 2;\n",
    );
    assert.equal(f.run().status, 1);
    assert.match(f.run().stderr, /file\.tsx:2: new code comment/);
    f.write("file.tsx", "// edited legacy comment\nexport const value = 2;\n");
    assert.equal(f.run().status, 1);
    f.write("file.tsx", "export const value = 2;\n");
    assert.equal(f.run().status, 0);
  });
});

test("literal text in JavaScript, regex, JSX and templates does not become a comment", () => {
  withFixture((f) => {
    f.write(
      "literals.tsx",
      [
        "const pattern = /https?:\\/\\//;",
        'const string = "/* literal */ // literal";',
        "const template = `// literal ${string} /* literal */`;",
        'const jsx = <div title="// literal">// literal {string}</div>;',
        "const escaped = /[/*]/;",
        'const url = "https://example.invalid";',
      ].join("\n"),
    );
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    f.write("literals.tsx", "const jsx = <div>{/* actual comment */}</div>;\n");
    assert.equal(f.run().status, 1);
    f.write("literals.tsx", "const template = `literal ${1 /* actual comment */} tail`;\n");
    assert.equal(f.run().status, 1);
  });
});

test("TS and JS comments before operators, empty bodies, declarations and EOF are inspected", () => {
  withFixture((f) => {
    for (const content of [
      "/* first */ const x = 1;",
      "const x = 1 /* middle */ + 2;",
      "const x = 1; // last",
      "const x = () => { /* empty */ };",
      "/** public docs require review */ export const x = 1;",
    ]) {
      f.write("new.mjs", content);
      assert.equal(f.run().status, 1, content);
    }
  });
});

test("Go strings, runes and raw literals are preserved while comments are rejected", () => {
  withFixture((f) => {
    f.write(
      "main.go",
      'package main\nvar a = "// literal \\" /* literal */"\nvar b = `/* literal */ // literal`\nvar c = \'/\'\n',
    );
    assert.equal(f.run().status, 0);
    f.write("main.go", "package main\n// newly added\nvar a = 1\n");
    assert.equal(f.run().status, 1);
    f.write("main.go", "package main\nvar a = 1 /* newly added */\n");
    assert.equal(f.run().status, 1);
    f.write("main.go", "package main\nvar a = `unterminated\n");
    assert.equal(f.run().status, 1);
  });
});

test("staged inspection reads the index rather than unstaged file contents", () => {
  withFixture((f) => {
    f.write("file.tsx", "export const value = 2; // staged comment\n");
    f.git("add", "file.tsx");
    f.write("file.tsx", "export const value = 3;\n");
    assert.equal(f.run("--staged").status, 1);
    assert.equal(f.run().status, 0);
    f.git("add", "file.tsx");
    f.write("file.tsx", "export const value = 4; // unstaged comment\n");
    assert.equal(f.run("--staged").status, 0);
    assert.equal(f.run().status, 1);
  });
});

test("commit comparison ignores working-tree edits and refuses invalid or option-shaped revisions", () => {
  withFixture((f) => {
    const base = f.git("rev-parse", "HEAD").trim();
    f.write("file.tsx", "export const value = 2; // committed comment\n");
    const head = f.commit();
    f.write("file.tsx", "export const value = 3;\n");
    assert.equal(f.run("--diff", base, head).status, 1);
    assert.equal(f.run("--diff", "not-a-revision", head).status, 1);
    assert.equal(f.run("--diff", base, "not-a-revision").status, 1);
    assert.equal(f.run("--diff", "--all", head).status, 1);
  });
});

test("full-file inspection includes old and untracked comments and reports excluded paths", () => {
  withFixture((f) => {
    assert.equal(f.run("--files", "file.tsx").status, 1);
    f.write("untracked.ts", "// new comment\nexport const x = 1;\n");
    assert.equal(f.run("--files", "untracked.ts").status, 1);
    for (const path of [
      "skills/fixture.mjs",
      "apps/learn/index.ts",
      "packages/design-system/index.ts",
      "apps/test/worker-configuration.d.ts",
      "apps/test/openapi/types.generated.ts",
    ]) {
      f.write(path, "// generated or submodule code\n");
      assert.equal(f.run("--files", path).status, 1, path);
      assert.match(f.run("--files", path).stderr, /excluded/);
    }
    assert.equal(f.run().status, 1);
    f.write("untracked.ts", "export const x = 1;\n");
    assert.equal(f.run().status, 0);
  });
});

function reviewedException(comment) {
  return {
    path: "new.ts",
    sha256: createHash("sha256").update(comment).digest("hex"),
    category: "external-contract",
    reason: "The external protocol fixes the operation order.",
    evidence: "https://example.invalid/protocol#ordering",
  };
}

test("exact reviewed exceptions permit only the reviewed comment", () => {
  withFixture((f) => {
    const comment = "// External protocol requires this exact ordering.";
    f.write("new.ts", `${comment}\nexport const x = 1;\n`);
    const exception = reviewedException(comment);
    f.write("scripts/code-comment-exceptions.json", JSON.stringify({ exceptions: [exception] }));
    assert.equal(f.run().status, 0);
    f.write("new.ts", `${comment} Changed.\nexport const x = 1;\n`);
    assert.equal(f.run().status, 1);
    f.write(
      "scripts/code-comment-exceptions.json",
      JSON.stringify({ exceptions: [{ ...exception, reason: "" }] }),
    );
    assert.equal(f.run().status, 1);
  });
});

test("unstaged exceptions cannot approve staged or committed comments", () => {
  withFixture((f) => {
    const comment = "// External protocol requires this exact ordering.";
    const base = f.git("rev-parse", "HEAD").trim();
    f.write("new.ts", `${comment}\nexport const x = 1;\n`);
    f.git("add", "new.ts");
    f.write(
      "scripts/code-comment-exceptions.json",
      JSON.stringify({ exceptions: [reviewedException(comment)] }),
    );
    assert.equal(f.run().status, 0);
    assert.equal(f.run("--staged").status, 1);
    f.git("-c", "commit.gpgsign=false", "commit", "-qm", "comment only");
    const head = f.git("rev-parse", "HEAD").trim();
    assert.equal(f.run("--diff", base, head).status, 1);
  });
});

test("syntax errors, missing files and outside paths fail closed", () => {
  withFixture((f) => {
    f.write("broken.ts", 'const x = "unterminated');
    assert.equal(f.run().status, 1);
    assert.equal(f.run("--files", "missing.ts").status, 1);
    assert.equal(f.run("--files", "../outside.ts").status, 1);
  });
});
