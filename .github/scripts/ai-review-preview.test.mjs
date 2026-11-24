import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import {
  APP_IMAGE,
  BROWSER_IMAGE,
  DISABLED_TOOLS,
  PREVIEW_APPS,
  Preview,
  holdConfig,
  holdSpec,
  selectPreviewApp,
} from "./ai-review-preview.mjs";
import {
  previewSection,
  reviewBody,
  reviewPrompt,
  setSigningKey,
  startPreview,
} from "./codex-review.mjs";

const root = join(import.meta.dirname, "../..");

function fakeDocker({ ready = { baseURL: "http://localhost:6185", states: [] }, exited = false }) {
  const calls = [];
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, input: options.input });
    const script = args.at(-1);
    if (command === "git") {
      return {
        stdout: args.includes("packages/design-system")
          ? `160000 commit ${"a".repeat(40)}\tpackages/design-system\n`
          : "",
      };
    }
    if (typeof script === "string" && script.includes("ready.json")) {
      if (exited) return { stdout: "EXITED\n" };
      return { stdout: ready ? JSON.stringify(ready) : "" };
    }
    if (typeof script === "string" && script.includes("tail -c")) {
      return { stdout: "Error: listen EADDRINUSE\n" };
    }
    return { stdout: "" };
  };
  return { calls, run };
}

function preview(docker, overrides = {}) {
  const instance = new Preview({ id: 7, run: docker.run, wait: async () => {}, log: () => {} });
  instance.archive = () => Readable.from([]);
  Object.assign(instance, overrides);
  return instance;
}

test("selectPreviewApp picks the previewable app with the most changed files", () => {
  assert.equal(
    selectPreviewApp([
      "apps/ost/app/routes/events/home.tsx",
      "apps/wiki/app/a.ts",
      "apps/wiki/app/b.ts",
      "docs/x.md",
    ]),
    "wiki",
  );
  assert.equal(selectPreviewApp(["apps/website/src/index.ts", "packages/gdg-lib/x.ts"]), null);
  assert.equal(selectPreviewApp([".github/scripts/codex-review.mjs"]), null);
});

test("every preview app has a Playwright config and an E2E script that forwards arguments", () => {
  for (const app of PREVIEW_APPS) {
    const directory = join(root, "apps", app);
    assert.ok(existsSync(join(directory, "playwright.config.ts")), app);
    const script = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).scripts[
      "test:e2e"
    ];
    assert.match(script, /^(playwright test|node (e2e|tests\/e2e)\/run\.mjs)$/, app);
    if (script.startsWith("node")) {
      const runner = readFileSync(join(directory, script.slice("node ".length)), "utf8");
      assert.match(runner, /"playwright", "test", \.\.\.process\.argv\.slice\(2\)/, app);
    }
  }
});

test("the preview cuts the app container off the network before running the PR's servers", async () => {
  const docker = fakeDocker({
    ready: { baseURL: "http://localhost:6177", states: ["admin.json"] },
  });
  const ready = await preview(docker).start({ dir: "/work/pr-7", app: "wiki" });
  assert.deepEqual(ready, {
    app: "wiki",
    baseURL: "http://localhost:6177",
    states: ["admin.json"],
  });
  const dockerCalls = docker.calls.filter((call) => call.command === "docker");
  const created = dockerCalls.find((call) => call.args[0] === "run");
  assert.ok(created.args.includes(APP_IMAGE));
  assert.deepEqual(
    created.args.filter((arg, index) => created.args[index - 1] === "-e"),
    ["CI=true", "COREPACK_ENABLE_DOWNLOAD_PROMPT=0"],
  );
  assert.deepEqual(
    created.args.filter((arg, index) => created.args[index - 1] === "-v"),
    ["gdg-preview-7:/preview"],
  );
  const install = dockerCalls.findIndex((call) =>
    String(call.args.at(-1)).includes("pnpm install"),
  );
  const disconnect = dockerCalls.findIndex(
    (call) => call.args.join(" ") === "network disconnect bridge gdg-preview-7",
  );
  const serve = dockerCalls.findIndex((call) =>
    String(call.args.at(-1)).includes("run-isolated-e2e.mjs --workspace @gdgjp/wiki"),
  );
  assert.ok(install >= 0 && install < disconnect && disconnect < serve);
  assert.match(dockerCalls[install].args.at(-1), /fetch -q --depth 1 .*design-system\.git' a{40}/);
});

test("the preview reports the log tail when the servers stop before they are ready", async () => {
  const docker = fakeDocker({ exited: true });
  await assert.rejects(
    preview(docker).start({ dir: "/work/pr-7", app: "ost" }),
    /the preview stopped: Error: listen EADDRINUSE/,
  );
});

test("the browser shares only the app container's network and reads the shared volume", () => {
  const config = preview(fakeDocker({})).codexConfig();
  const values = Object.fromEntries(
    config
      .filter((_, index) => config[index - 1] === "-c")
      .map((entry) => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)]),
  );
  assert.equal(values["mcp_servers.browser.command"], '"docker"');
  const args = JSON.parse(values["mcp_servers.browser.args"]);
  assert.equal(args[args.indexOf("--network") + 1], "container:gdg-preview-7");
  assert.equal(args[args.indexOf("-v") + 1], "gdg-preview-7:/preview:ro");
  assert.equal(args[args.indexOf("--cap-drop") + 1], "ALL");
  assert.ok(args.includes(BROWSER_IMAGE));
  assert.ok(!args.some((arg) => arg.includes("docker.sock")));
  assert.deepEqual(JSON.parse(values["mcp_servers.browser.disabled_tools"]), DISABLED_TOOLS);
  assert.equal(values["mcp_servers.browser.default_tools_approval_mode"], '"approve"');
});

test("the hold files reuse the app's Playwright config and publish readiness", () => {
  assert.match(holdConfig(), /import base from "\.\/playwright\.config";/);
  assert.match(holdConfig(), /testMatch: "hold\.spec\.ts"/);
  assert.match(holdSpec(), /ready\.json/);
  assert.match(holdSpec(), /storage-state/);
});

test("startPreview falls back to a code-only review when the preview fails", async () => {
  let stopped = 0;
  const failing = {
    start: async () => {
      throw new Error("the preview stopped: boom");
    },
    stop: async () => {
      stopped += 1;
    },
    codexConfig: () => ["-c", "unused"],
  };
  const pr = { number: 7 };
  const result = await startPreview(() => failing, pr, "/work", ["apps/ost/app/x.tsx"]);
  assert.deepEqual(result.info, { app: "ost", error: "the preview stopped: boom" });
  assert.deepEqual(result.config, []);
  assert.equal(stopped, 1);
  assert.equal(await startPreview(() => failing, pr, "/work", ["docs/a.md"]), null);
  assert.equal(await startPreview(null, pr, "/work", ["apps/ost/app/x.tsx"]), null);
});

test("prompts and the review footer describe the preview", () => {
  setSigningKey("p".repeat(40));
  const pr = { number: 7, title: "t", body: "", headSha: "abc1234def", baseRef: "main" };
  const ready = { app: "ost", baseURL: "http://localhost:6185", states: ["admin.json"] };
  const prompt = reviewPrompt(pr, { mergeBase: "m", files: [], previous: [], preview: ready });
  assert.match(prompt, /running at\nhttp:\/\/localhost:6185/);
  assert.match(prompt, /admin\.json/);
  assert.match(previewSection({ app: "ost", error: "boom" }), /could not start[\s\S]*boom/);
  assert.equal(previewSection(null), "");
  const body = reviewBody(
    { summary: "ok", findings: [] },
    { pr: 7, head: "abc1234def", requested: "r", ids: [], model: "m", preview: ready },
  );
  assert.match(body, /m · abc1234 · apps\/ost をブラウザで確認 · \[AI review gate\]/);
});
