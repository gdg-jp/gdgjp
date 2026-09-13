import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import { findViolations, parseArgs } from "../../scripts/check-ui-conventions.mjs";

const checker = resolve("scripts/check-ui-conventions.mjs");

const validCss = `@layer theme, base, gdg-tokens, gdg-base, gdg-components, utilities;
@import "tailwindcss";
@import "@gdgjp/ui/tailwind.css";
@import "@gdgjp/ui/components.css";
@import "@gdgjp/ui/fonts.css";
.remote-cursor { position: relative; }
`;

const validRoot = `import { ThemeProvider, Toaster } from "@gdgjp/ui";
export function Layout({ children }) {
  return <html lang="ja"><body><ThemeProvider storageKey="gdg-apps-theme" defaultTheme="system">{children}</ThemeProvider></body></html>;
}
export function ErrorBoundary() { return <div>error</div>; }
export default function App() { return <><main /><Toaster /></>; }
`;

function createRepo(files) {
  const directory = mkdtempSync(join(tmpdir(), "gdgjp-ui-conventions-"));
  for (const [path, contents] of Object.entries(files)) {
    const fullPath = join(directory, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, contents);
  }
  execFileSync("git", ["init", "-q"], { cwd: directory });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: directory });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: directory });
  execFileSync("git", ["add", "."], { cwd: directory });
  return directory;
}

function runChecker(directory, args = []) {
  return spawnSync(process.execPath, [checker, ...args], {
    cwd: directory,
    encoding: "utf8",
  });
}

function foundationFiles(source = "export default function App() { return <div />; }\n") {
  return {
    "wiki/package.json": JSON.stringify({ dependencies: { "@gdgjp/ui": "workspace:*" } }),
    "wiki/app/app.css": validCss,
    "wiki/app/root.tsx": validRoot,
    "wiki/app/routes/example.tsx": source,
    "wiki/tests/architecture/ui-conventions-baseline.json": '{"version":1,"entries":[]}',
  };
}

test("scans all source extensions and separates literal colors from layout arbitrary values", () => {
  for (const extension of [".ts", ".tsx", ".js", ".jsx"]) {
    assert.deepEqual(findViolations(`import Icon from "lucide-react";`, { extension }), [
      { ruleId: "legacy-import", line: 1, fingerprint: "lucide-react" },
    ]);
  }
  assert.deepEqual(
    findViolations(
      '<div className="max-w-[calc(100vw-2rem)] grid-cols-[1fr_2fr] [&_*]:p-2 bg-[#fff]" />',
      { extension: ".tsx" },
    ),
    [{ ruleId: "literal-color", line: 1, fingerprint: "bg-[#fff]" }],
  );
  assert.deepEqual(
    findViolations(".bridge { color: #fff; width: calc(100% - 1rem); }", { extension: ".css" }),
    [{ ruleId: "literal-color", line: 1, fingerprint: "#fff" }],
  );
});

test("handles multiline JSX contracts, namespace components, and expression class names", () => {
  const source = `<UI.Stack
  className={cn("items-center", condition ? "gap-2" : "gap-4")}
/>;
<Button
  className={"w-full"}
/>;
<FormField
  label={<span className="gdg-sr-only">Hidden</span>}
/>;`;
  assert.deepEqual(
    findViolations(source, { extension: ".tsx" }).map(({ ruleId, line, fingerprint }) => ({
      ruleId,
      line,
      fingerprint,
    })),
    [
      { ruleId: "stack-align", line: 2, fingerprint: "items-center" },
      { ruleId: "button-full-width", line: 5, fingerprint: "w-full" },
      { ruleId: "form-field-hide-label", line: 8, fingerprint: "gdg-sr-only" },
    ],
  );
});

test("accepts a one-line allowance only for a known, directly following violation", () => {
  const allowed = runChecker(
    createRepo(
      foundationFiles(`export default function App() {
  // gdg-ui-allow: literal-color — legacy browser widget requires this brand color
  return <div className="bg-[#fff]" />;
}
`),
    ),
    ["--app", "wiki"],
  );
  assert.equal(allowed.status, 0, allowed.stderr);

  const stale = runChecker(
    createRepo(
      foundationFiles(`// gdg-ui-allow: literal-color — legacy browser widget requires this brand color
export default function App() { return <div />; }
`),
    ),
    ["--app", "wiki"],
  );
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /stale allowance/);
});

test("uses the index snapshot for staged content, manifest, CSS, and legacy directory state", () => {
  const directory = createRepo(foundationFiles());
  writeFileSync(join(directory, "wiki/app/routes/example.tsx"), '<div className="bg-[#fff]" />;\n');
  const cleanIndex = runChecker(directory, ["--app", "wiki", "--staged"]);
  assert.equal(cleanIndex.status, 0, cleanIndex.stderr);

  execFileSync("git", ["add", "wiki/app/routes/example.tsx"], { cwd: directory });
  const stagedViolation = runChecker(directory, ["--app", "wiki", "--staged"]);
  assert.equal(stagedViolation.status, 1);
  assert.match(stagedViolation.stderr, /bg-\[#fff\]/);

  writeFileSync(
    join(directory, "wiki/app/routes/example.tsx"),
    "export default function App() { return <div />; }\n",
  );
  const indexStillWins = runChecker(directory, ["--app", "wiki", "--staged"]);
  assert.equal(indexStillWins.status, 1, "working-tree rewrites must not hide a staged violation");
  assert.match(indexStillWins.stderr, /bg-\[#fff\]/);
  rmSync(directory, { recursive: true, force: true });
});

test("rejects staged deletion and working-tree recreation of a required file", () => {
  const directory = createRepo(foundationFiles());
  execFileSync("git", ["rm", "-q", "-f", "wiki/app/app.css"], { cwd: directory });
  writeFileSync(join(directory, "wiki/app/app.css"), validCss);
  const result = runChecker(directory, ["--app", "wiki", "--staged"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /wiki\/app\/app\.css: missing stylesheet/);
  rmSync(directory, { recursive: true, force: true });
});

test("enforces exact baseline identities and allows only shrinkage", () => {
  const base = foundationFiles('import Icon from "lucide-react";\nexport default Icon;\n');
  base["wiki/tests/architecture/ui-conventions-baseline.json"] = JSON.stringify({
    version: 1,
    entries: [
      {
        ruleId: "legacy-import",
        path: "wiki/app/routes/example.tsx",
        fingerprint: "lucide-react",
        count: 1,
      },
    ],
  });
  const allowed = runChecker(createRepo(base), ["--app", "wiki"]);
  assert.equal(allowed.status, 0, allowed.stderr);

  base["wiki/app/routes/example.tsx"] =
    `${base["wiki/app/routes/example.tsx"]}\nimport X from "lucide-react";\n`;
  const increased = runChecker(createRepo(base), ["--app", "wiki"]);
  assert.equal(increased.status, 1);
  assert.match(increased.stderr, /increased from 1 to 2/);
});

test("parses repeated app arguments and staged mode without executing at import time", () => {
  assert.deepEqual(parseArgs(["--staged", "--app", "wiki", "--app", "accounts"]), {
    staged: true,
    apps: ["wiki", "accounts"],
  });
});
