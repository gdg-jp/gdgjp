import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import {
  checkEffects,
  describeUse,
  findEffectUses,
  isEffectSource,
  parseArgs,
} from "../../scripts/check-effects.mjs";

const checker = resolve("scripts/check-effects.mjs");

function createRepo(files) {
  const directory = mkdtempSync(join(tmpdir(), "gdgjp-effects-"));
  write(directory, files);
  execFileSync("git", ["init", "-q"], { cwd: directory });
  execFileSync("git", ["add", "."], { cwd: directory });
  return directory;
}

function write(directory, files) {
  for (const [path, contents] of Object.entries(files)) {
    const full = join(directory, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof contents === "string" ? contents : JSON.stringify(contents));
  }
}

function run(directory, args = []) {
  return spawnSync(process.execPath, [checker, ...args], { cwd: directory, encoding: "utf8" });
}

const listenerEffect = `import { useEffect } from "react";
export function A() {
  useEffect(() => {
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return null;
}
`;

const policy = { frameworkModules: [], allowances: [] };
const emptyBaseline = { version: 1, entries: [] };

test("finds effects through named, aliased, default, and namespace React imports", () => {
  const source = `import React, { useEffect, useLayoutEffect as layout } from "react";
import * as R from "react";
useEffect(() => {});
layout(() => {});
React.useEffect(() => {});
R.useLayoutEffect(() => {});
`;
  assert.deepEqual(
    findEffectUses(source, "a.tsx").map(({ api, line }) => [api, line]),
    [
      ["useEffect", 3],
      ["useLayoutEffect", 4],
      ["useEffect", 5],
      ["useLayoutEffect", 6],
    ],
  );
});

test("ignores text, comments, injected schedulers, and non-React hooks with the same name", () => {
  const source = `const text = "useEffect(() => {}) setTimeout(1)";
/* setInterval(tick, 1) */
class Clock { constructor(timers) { this.timers = timers; } start() { this.timers.setTimeout(run, 1); } }
function useEffect(callback) { callback(); }
useEffect(() => {});
`;
  assert.deepEqual(findEffectUses(source, "a.ts"), []);
});

test("finds bare and global-receiver timers", () => {
  const source = `setTimeout(run, 1);
window.setInterval(run, 1);
globalThis.requestAnimationFrame(run);
self.requestIdleCallback(run);
`;
  assert.deepEqual(
    findEffectUses(source, "a.ts").map(({ api }) => api),
    ["setTimeout", "setInterval", "requestAnimationFrame", "requestIdleCallback"],
  );
});

test("classifies each use and names its replacement and root cause", () => {
  const classify = (source, path = "a.tsx") =>
    findEffectUses(source, path).map((use) => use.category);
  assert.deepEqual(classify(listenerEffect), ["listener"]);
  assert.deepEqual(
    classify(`import { useEffect } from "react";
useEffect(() => { if (fetcher.data?.ok) toast("saved"); }, [fetcher.data]);
useEffect(() => { setDraft(initial); }, [initial]);
useEffect(() => { const media = matchMedia("(x)"); }, []);
useEffect(() => { fetch("/api"); }, []);`),
    ["fetcher-result", "derived-state", "media-query", "fetch"],
  );
  assert.deepEqual(
    classify(
      `const id = setTimeout(() => controller.abort(), 10);
await new Promise((resolve) => setTimeout(resolve, 10));
class Socket { retry() { this.timer = setTimeout(this.connect, 10); } }`,
      "a.ts",
    ),
    ["abort-deadline", "sleep", "scheduler"],
  );
  assert.deepEqual(
    classify(`import { useState } from "react";
function A() { const go = () => setTimeout(() => setCopied(false), 10); }`),
    ["react-timer"],
  );
  const [use] = findEffectUses(listenerEffect, "a.tsx");
  const message = describeUse("apps/x/app/a.tsx", use);
  assert.match(message, /^apps\/x\/app\/a\.tsx:3: useEffect attaches an event listener/);
  assert.match(message, /useEventListener\(.*@gdgjp\/gdg-lib\/react/);
  assert.match(message, /Root cause: /);
});

test("scopes product code and excludes tests, tooling, and submodules", () => {
  assert.equal(isEffectSource("apps/wiki/app/routes/home.tsx"), true);
  assert.equal(isEffectSource("apps/wiki/workers/app.ts"), true);
  assert.equal(isEffectSource("packages/gdg-lib/src/ui/theme.tsx"), true);
  for (const path of [
    "apps/wiki/app/routes/home.test.tsx",
    "apps/wiki/e2e/home.spec.ts",
    "apps/wiki/tests/architecture/x.ts",
    "apps/agent/eval/run.ts",
    "apps/learn/app/x.tsx",
    "apps/cli/x.ts",
    "packages/design-system/src/x.tsx",
    "packages/gdg-lib/src/testing/render-hook.tsx",
    "apps/wiki/worker-configuration.d.ts",
  ]) {
    assert.equal(isEffectSource(path), false, path);
  }
});

test("rejects a new effect with the category guidance and the policy pointer", () => {
  const repo = createRepo({
    "apps/x/app/a.tsx": listenerEffect,
    "scripts/effects-policy.json": policy,
    "scripts/effects-baseline.json": emptyBaseline,
  });
  try {
    const result = run(repo);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /apps\/x\/app\/a\.tsx: 1 new useEffect call in product code/);
    assert.match(result.stderr, /Use useEventListener/);
    assert.match(result.stderr, /docs\/engineering\/effects\.md/);
    assert.match(result.stderr, /never add entries to scripts\/effects-baseline\.json/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("accepts baselined counts, rejects increases, and requires shrinking", () => {
  const repo = createRepo({
    "apps/x/app/a.tsx": listenerEffect,
    "scripts/effects-policy.json": policy,
    "scripts/effects-baseline.json": {
      version: 1,
      entries: [{ path: "apps/x/app/a.tsx", api: "useEffect", count: 1 }],
    },
  });
  try {
    assert.equal(run(repo).status, 0);
    write(repo, { "apps/x/app/a.tsx": `${listenerEffect}useEffect(() => {}, []);\n` });
    const increased = run(repo);
    assert.equal(increased.status, 1);
    assert.match(increased.stderr, /increased from the baseline of 1 to 2/);
    write(repo, { "apps/x/app/a.tsx": "export const A = () => null;\n" });
    const shrunk = run(repo);
    assert.equal(shrunk.status, 1);
    assert.match(
      shrunk.stderr,
      /dropped from 1 to 0; run node scripts\/check-effects\.mjs --shrink-baseline/,
    );
    assert.equal(run(repo, ["--shrink-baseline"]).status, 0);
    assert.deepEqual(
      JSON.parse(readFileSync(join(repo, "scripts/effects-baseline.json"), "utf8")),
      {
        version: 1,
        entries: [],
      },
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("--shrink-baseline never adds or raises entries", () => {
  const repo = createRepo({
    "apps/x/app/a.tsx": `${listenerEffect}useEffect(() => {}, []);\n`,
    "apps/x/app/b.tsx": listenerEffect,
    "scripts/effects-policy.json": policy,
    "scripts/effects-baseline.json": {
      version: 1,
      entries: [{ path: "apps/x/app/a.tsx", api: "useEffect", count: 1 }],
    },
  });
  try {
    assert.equal(run(repo, ["--shrink-baseline"]).status, 1);
    assert.deepEqual(
      JSON.parse(readFileSync(join(repo, "scripts/effects-baseline.json"), "utf8")).entries,
      [{ path: "apps/x/app/a.tsx", api: "useEffect", count: 1 }],
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("exact allowances and framework modules permit reviewed calls only", () => {
  const repo = createRepo({
    "apps/x/app/a.ts": "setTimeout(run, 1);\n",
    "packages/gdg-lib/src/react/hook.ts": listenerEffect,
    "scripts/effects-policy.json": {
      frameworkModules: [
        { path: "packages/gdg-lib/src/react/", reason: "shared hooks own effects" },
      ],
      allowances: [
        {
          path: "apps/x/app/a.ts",
          api: "setTimeout",
          count: 1,
          reason: "the vendor SDK requires polling",
        },
      ],
    },
    "scripts/effects-baseline.json": emptyBaseline,
  });
  try {
    assert.equal(run(repo).status, 0);
    write(repo, { "apps/x/app/a.ts": "export {};\n" });
    const stale = run(repo);
    assert.equal(stale.status, 1);
    assert.match(
      stale.stderr,
      /allowance for apps\/x\/app\/a\.ts setTimeout expects 1 but found 0/,
    );
    write(repo, {
      "scripts/effects-policy.json": {
        frameworkModules: [],
        allowances: [{ path: "apps/x/app/a.ts", api: "setTimeout", count: 1, reason: "short" }],
      },
    });
    assert.match(run(repo).stderr, /reason naming the external constraint/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("staged mode reads the index, not the working tree", () => {
  const repo = createRepo({
    "apps/x/app/a.tsx": "export const A = () => null;\n",
    "scripts/effects-policy.json": policy,
    "scripts/effects-baseline.json": emptyBaseline,
  });
  try {
    write(repo, { "apps/x/app/a.tsx": listenerEffect });
    execFileSync("git", ["add", "apps/x/app/a.tsx"], { cwd: repo });
    write(repo, { "apps/x/app/a.tsx": "export const A = () => null;\n" });
    const staged = run(repo, ["--staged"]);
    assert.equal(staged.status, 1);
    assert.match(staged.stderr, /1 new useEffect call/);
    assert.equal(checkEffects({ cwd: repo }).errors.length, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("rejects unknown and conflicting arguments", () => {
  assert.throws(() => parseArgs(["--bogus"]), /Usage:/);
  assert.throws(() => parseArgs(["--staged", "--shrink-baseline"]), /cannot be combined/);
  assert.deepEqual(parseArgs(["--files", "a.ts", "b.ts"]).files, ["a.ts", "b.ts"]);
});

test("the effects check runs in lint, local CI selection, and hosted CI", async () => {
  const { changedSteps, completeSteps } = await import("../../scripts/run-ci.mjs");
  const { classifyChanges } = await import("./changed-workspaces.mjs");
  for (const mode of ["quick", "full"]) {
    assert.ok(completeSteps(mode).some(([name]) => name === "effects"));
    for (const file of [
      "apps/wiki/app/root.tsx",
      "packages/gdg-lib/src/ui/theme.tsx",
      "scripts/check-effects.mjs",
      "scripts/effects-baseline.json",
      "scripts/effects-policy.json",
    ]) {
      const step = changedSteps(mode, [file]).find(([name]) => name === "effects");
      assert.equal(step?.[1], "node scripts/check-effects.mjs", file);
    }
    assert.equal(
      changedSteps(mode, ["apps/wiki/app/root.test.tsx"]).some(([name]) => name === "effects"),
      false,
    );
  }
  assert.equal(classifyChanges(["scripts/check-effects.mjs"]).scriptTests, true);
  const workflow = readFileSync(new URL("../workflows/ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /run: node scripts\/check-effects\.mjs\n/);
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.match(manifest.scripts.lint, /node scripts\/check-effects\.mjs/);
});
