import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkWorkspaceBoundaries } from "../../scripts/check-workspace-boundaries.mjs";

const cli = fileURLToPath(new URL("../../scripts/check-workspace-boundaries.mjs", import.meta.url));

function fixture(t, entries = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "workspace-boundaries-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file, value) => {
    const path = resolve(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  };
  put("apps/one/package.json", {
    name: "@gdgjp/one",
    dependencies: { "@gdgjp/lib": "workspace:*" },
  });
  put("apps/two/package.json", { name: "@gdgjp/two" });
  put("packages/lib/package.json", {
    name: "@gdgjp/lib",
    exports: { ".": "./src/index.ts", "./public": "./src/public.ts" },
  });
  for (const [file, value] of Object.entries(entries)) put(file, value);
  return { root, put };
}

test("allows local modules, declared package entries and non-workspace data contracts", (t) => {
  const { root } = fixture(t, {
    "apps/one/tsconfig.json": {
      compilerOptions: { paths: { "~/*": ["./src/*"], "@skills/*": ["../../skills/*"] } },
    },
    "apps/one/src/index.ts": `
      import { local } from "~/local";
      import { publicValue } from "@gdgjp/lib/public";
      export type Contract = import("@gdgjp/lib").Contract;
      import instructions from "../../../docs/spec.md?raw";
      import renderer from "@skills/render/index.mjs";
      export * from "./local";
    `,
    "apps/one/src/local.ts": "export const local = 1;",
    "packages/lib/src/index.ts": "export type Contract = string;",
  });
  const result = checkWorkspaceBoundaries(root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.files, 3);
  assert.equal(result.imports, 6);
});

test("rejects multiline imports, reexports, dynamic imports, require and import types across apps", (t) => {
  const { root } = fixture(t, {
    "apps/one/src/index.ts": `
      import {
        secret
      } from "../../two/src/missing";
      export * from "../../two/src/other";
      const dynamic = import("../../two/src/runtime");
      const required = require("../../two/src/legacy");
      type Contract = import("../../two/src/types").Contract;
      import legacy = require("../../two/src/legacy-two");
      const text = "import('not-an-edge')";
    `,
  });
  const result = checkWorkspaceBoundaries(root);
  assert.equal(result.imports, 6);
  assert.equal(result.errors.length, 6);
  assert.ok(result.errors.every((error) => error.includes("crosses into apps/two by path")));
  assert.match(result.errors[0], /apps\/one\/src\/index.ts:4:/);
});

test("rejects alias escapes even when the target file or workspace manifest is absent", (t) => {
  const { root } = fixture(t, {
    "apps/one/tsconfig.json": {
      compilerOptions: {
        baseUrl: ".",
        paths: { "@foreign/*": ["../two/src/*"], "@absent": ["../absent/src/index.ts"] },
      },
    },
    "apps/one/src/index.ts": 'import "@foreign/nonexistent"; import "@absent";',
  });
  const errors = checkWorkspaceBoundaries(root).errors;
  assert.equal(errors.length, 2);
  assert.match(errors[0], /apps\/two/);
  assert.match(errors[1], /apps\/absent/);
});

test("honors extended tsconfig paths", (t) => {
  const { root } = fixture(t, {
    "tsconfig.base.json": { compilerOptions: { paths: { "@foreign/*": ["./apps/two/src/*"] } } },
    "apps/one/tsconfig.json": { extends: "../../tsconfig.base.json" },
    "apps/one/index.ts": 'import "@foreign/no-file";',
  });
  assert.match(checkWorkspaceBoundaries(root).errors[0], /crosses into apps\/two/);
});

test("resolves the ownership of a differently named package symlink", (t) => {
  const { root } = fixture(t, {
    "apps/two/package.json": { name: "@gdgjp/two", main: "./index.ts" },
    "apps/two/index.ts": "export const secret = 1;",
    "apps/one/index.ts": 'import { secret } from "linked";',
  });
  mkdirSync(resolve(root, "apps/one/node_modules"));
  symlinkSync(resolve(root, "apps/two"), resolve(root, "apps/one/node_modules/linked"));
  const errors = checkWorkspaceBoundaries(root).errors;
  assert.equal(errors.length, 1);
  assert.match(errors[0], /resolves into apps\/two/);
});

test("resolves Node package import aliases without treating their leading hash as a fragment", (t) => {
  const { root } = fixture(t, {
    "apps/one/package.json": { name: "@gdgjp/one", imports: { "#other": "@gdgjp/two" } },
    "apps/one/tsconfig.json": {
      compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext" },
    },
    "apps/two/package.json": { name: "@gdgjp/two", main: "./index.ts" },
    "apps/two/index.ts": "export const secret = 1;",
    "apps/one/index.ts": 'import { secret } from "#other";',
  });
  mkdirSync(resolve(root, "apps/one/node_modules/@gdgjp"), { recursive: true });
  symlinkSync(resolve(root, "apps/two"), resolve(root, "apps/one/node_modules/@gdgjp/two"));
  const errors = checkWorkspaceBoundaries(root).errors;
  assert.equal(errors.length, 1);
  assert.match(errors[0], /resolves into apps\/two/);
});

test("packages cannot import applications and apps cannot consume another application's package", (t) => {
  const { root } = fixture(t, {
    "packages/lib/src/index.ts": 'export * from "../../../apps/one/src/file";',
    "apps/one/index.ts": 'import "@gdgjp/two";',
    "apps/one/package.json": { name: "@gdgjp/one", dependencies: { "@gdgjp/two": "workspace:*" } },
  });
  const errors = checkWorkspaceBoundaries(root).errors;
  assert.equal(errors.length, 2);
  assert.ok(errors.some((error) => error.includes("applications are service boundaries")));
  assert.ok(errors.some((error) => error.includes("crosses into apps/one by path")));
});

test("package paths cannot bypass declarations or private exports", (t) => {
  const { root } = fixture(t, {
    "apps/one/index.ts": 'import "@gdgjp/lib/private"; import "../../packages/lib/src/index";',
    "apps/two/index.ts": 'import "@gdgjp/lib/public"; import "@gdgjp/missing";',
  });
  const errors = checkWorkspaceBoundaries(root).errors;
  assert.equal(errors.length, 4);
  assert.ok(errors.some((error) => error.includes("does not export")));
  assert.ok(errors.some((error) => error.includes("crosses into packages/lib by path")));
  assert.ok(errors.some((error) => error.includes("declare @gdgjp/lib")));
  assert.ok(errors.some((error) => error.includes("workspace @gdgjp/missing is missing")));
});

test("allows conditional and array exports while respecting null and specific pattern exclusions", (t) => {
  const { root } = fixture(t, {
    "packages/lib/package.json": {
      name: "@gdgjp/lib",
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
        "./array": [42, "./dist/array.js"],
        "./blocked-array": [null, "./dist/array.js"],
        "./feature/*": "./dist/*.js",
        "./feature/private/*": null,
        "./feature/blocked": null,
      },
    },
    "apps/one/index.ts": `
      import "@gdgjp/lib";
      import "@gdgjp/lib/array";
      import "@gdgjp/lib/feature/open";
      import "@gdgjp/lib/feature/blocked";
      import "@gdgjp/lib/feature/private/open";
      import "@gdgjp/lib/blocked-array";
    `,
  });
  const errors = checkWorkspaceBoundaries(root).errors;
  assert.equal(errors.length, 3);
  assert.ok(errors.every((error) => error.includes("does not export")));
});

test("does not scan separately owned submodules but checks their public imports", (t) => {
  const { root } = fixture(t, {
    ".gitmodules":
      '[submodule "ui"]\n  path = packages/ui\n[submodule "learn"]\n  path = apps/learn\n',
    "packages/ui/package.json": { name: "@gdgjp/ui", exports: { ".": "./dist/index.js" } },
    "packages/ui/index.ts": "this is deliberately invalid",
    "apps/learn/package.json": { name: "@gdgjp/learn" },
    "apps/learn/index.ts": 'import "../../one/private";',
    "apps/one/package.json": { name: "@gdgjp/one", dependencies: { "@gdgjp/ui": "workspace:*" } },
    "apps/one/index.ts": 'import "@gdgjp/ui"; import "@gdgjp/ui/private";',
  });
  const result = checkWorkspaceBoundaries(root);
  assert.equal(result.files, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /does not export/);
});

test("fails closed for referenced missing submodule manifests", (t) => {
  const { root } = fixture(t, {
    ".gitmodules": '[submodule "ui"]\n  path = packages/ui\n',
    "apps/one/package.json": { name: "@gdgjp/one", dependencies: { "@gdgjp/ui": "workspace:*" } },
    "apps/one/index.ts": 'import "@gdgjp/ui";',
  });
  const errors = checkWorkspaceBoundaries(root).errors;
  assert.equal(errors.length, 2);
  assert.ok(errors.every((error) => error.includes("initialize its submodule")));
});

test("reports malformed configuration and syntax through the CLI with nonzero exit", (t) => {
  const { root, put } = fixture(t, { "apps/one/tsconfig.json": "{ broken" });
  let result = spawnSync(process.execPath, [cli, "--root", root], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /expected/);
  put("apps/one/tsconfig.json", { extends: "./missing.json" });
  assert.throws(() => checkWorkspaceBoundaries(root), /missing.json/);
  put("apps/one/tsconfig.json", {});
  put("apps/one/index.ts", 'import "./local";');
  result = spawnSync(process.execPath, [cli, "--root", root], { encoding: "utf8" });
  assert.equal(result.status, 0);
  put("apps/one/index.ts", 'import "../two/missing";');
  result = spawnSync(process.execPath, [cli, "--root", root], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /crosses into apps\/two/);
  put("apps/one/index.ts", "export const = ;");
  result = spawnSync(process.execPath, [cli, "--root", root], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /expected/);
});

test("rejects an empty root and unsupported CLI arguments", (t) => {
  const root = mkdtempSync(resolve(tmpdir(), "workspace-boundaries-empty-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => checkWorkspaceBoundaries(root), /no apps\/\* or packages\/\*/);
  const result = spawnSync(process.execPath, [cli, "--skip"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});
