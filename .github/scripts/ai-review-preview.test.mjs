import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import {
  APP_IMAGE,
  BROWSER_IMAGE,
  DISABLED_TOOLS,
  PNPM,
  PREVIEW_APPS,
  Preview,
  holdConfig,
  holdSpec,
  readyInfo,
  registryLockfile,
  runCommand,
  selectPreviewApp,
} from "./ai-review-preview.mjs";
import {
  ReviewRepository,
  needsCodex,
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
    if (command === "git" && args.includes("show")) {
      return { stdout: "  /a@1.0.0:\n    resolution: {integrity: sha512-AAAA+/==}\n" };
    }
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
  assert.equal(
    selectPreviewApp([
      ["apps/wiki/app/b.tsx", "apps/wiki/app/a.tsx"],
      ["apps/wiki/app/d.tsx", "apps/wiki/app/c.tsx"],
      ["apps/ost/app/x.tsx"],
      ["apps/ost/app/y.tsx"],
      ["apps/ost/app/z.tsx"],
    ]),
    "ost",
  );
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

test("the preview runs no PR code until the app container is off the network", async () => {
  const docker = fakeDocker({
    ready: { baseURL: "http://localhost:6177", states: ["admin.json"], app: "x](y)" },
  });
  const ready = await preview(docker).start({ dir: "/work/pr-7", app: "wiki" });
  assert.deepEqual(ready, { baseURL: "http://localhost:6177", states: ["admin.json"] });
  const dockerCalls = docker.calls.filter((call) => call.command === "docker");
  const created = dockerCalls.find((call) => call.args[0] === "run");
  assert.ok(created.args.includes(APP_IMAGE));
  assert.deepEqual(
    created.args.filter((arg, index) => created.args[index - 1] === "-e"),
    ["CI=true"],
  );
  assert.deepEqual(
    created.args.filter((arg, index) => created.args[index - 1] === "-v"),
    ["gdg-preview-7:/preview"],
  );
  const script = (call) => String(call.args.at(-1));
  const index = (predicate) => dockerCalls.findIndex(predicate);
  const submodules = index((call) => script(call).includes("design-system.git"));
  const pnpm = index((call) => script(call).startsWith("npm install --global"));
  const lockfile = index((call) => script(call).includes("cat > /deps/pnpm-lock.yaml"));
  const fetch = index((call) => script(call).includes("pnpm fetch"));
  const disconnect = index(
    (call) => call.args.join(" ") === "network disconnect bridge gdg-preview-7",
  );
  const rebuild = index((call) => script(call).startsWith("pnpm install --offline"));
  const serve = index((call) =>
    script(call).includes("run-isolated-e2e.mjs --workspace @gdgjp/wiki"),
  );
  assert.ok(submodules >= 0 && submodules < pnpm && pnpm < lockfile && lockfile < fetch);
  assert.ok(fetch < disconnect);
  assert.ok(disconnect < rebuild && rebuild < serve);
  assert.match(script(dockerCalls[submodules]), /fetch -q --depth 1 .*design-system\.git' a{40}/);
  assert.equal(
    dockerCalls[pnpm].args[dockerCalls[pnpm].args.indexOf("-w") + 1],
    "/",
    "npm must not read the pull request's .npmrc",
  );
  assert.match(script(dockerCalls[pnpm]), new RegExp(`pnpm@${PNPM.replaceAll(".", "\\.")}$`));
  assert.equal(dockerCalls[fetch].args[dockerCalls[fetch].args.indexOf("-w") + 1], "/deps");
  assert.match(
    script(dockerCalls[fetch]),
    /^npm_config_userconfig=\/dev\/null pnpm fetch --ignore-pnpmfile --config\.registry=https:\/\/registry\.npmjs\.org\/ /,
  );
  const online = dockerCalls.slice(0, disconnect).map(script);
  assert.ok(!online.some((text) => /corepack|\bpnpm (install|run|exec|rebuild)/.test(text)));
});

test("readyInfo accepts only a loopback URL and plain storage state names", () => {
  assert.deepEqual(readyInfo('{"baseURL":"http://127.0.0.1:6185/","states":["a.json"]}'), {
    baseURL: "http://127.0.0.1:6185/",
    states: ["a.json"],
  });
  for (const text of [
    "nope",
    '{"baseURL":"https://evil.example"}',
    '{"baseURL":"http://localhost:99999"}',
    '{"baseURL":"http://localhost:0"}',
    `{"baseURL":"http://localhost:6185","pad":"${"あ".repeat(22000)}"}`,
    '{"baseURL":"http://localhost:6185@evil.example"}',
    '{"baseURL":"http://localhost:6185","states":"a.json"}',
    '{"baseURL":"http://localhost:6185","states":["../auth.json"]}',
    `{"baseURL":"http://localhost:6185","pad":"${"x".repeat(70000)}"}`,
  ]) {
    assert.throws(() => readyInfo(text), /preview/);
  }
});

test("runCommand stops a command that writes more than its output limit", async () => {
  const sh = (script, options) => runCommand("sh", ["-c", script], options);
  await assert.rejects(sh("printf 'x%.0s' $(seq 4096)", { maxOutput: 1024 }), /wrote too much/);
  await assert.rejects(
    sh("for i in 1 2 3 4 5 6 7 8; do printf 'あ%.0s' $(seq 100); sleep 0.01; done", {
      maxOutput: 2000,
    }),
    /wrote too much/,
  );
  const { stdout } = await sh("printf ok");
  assert.equal(stdout, "ok");
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
  assert.match(body, /m · abc1234 · apps\/ost のプレビューを用意 · \[AI review gate\]/);
});

test("startPreview keeps the host's app name over the preview's", async () => {
  const fake = {
    start: async () => ({ baseURL: "http://localhost:6185", states: [] }),
    stop: async () => {},
    codexConfig: () => ["-c", "x"],
  };
  const result = await startPreview(() => fake, { number: 7 }, "/w", ["apps/ost/a.tsx"]);
  assert.deepEqual(result.info, { baseURL: "http://localhost:6185", states: [], app: "ost" });
  assert.deepEqual(result.config, ["-c", "x"]);
});

test("the preview starts only when Codex has a review or a verification to run", () => {
  assert.equal(needsCodex({ reviewRequested: true, verifications: [] }), true);
  assert.equal(needsCodex({ reviewRequested: false, verifications: [{}] }), true);
  assert.equal(needsCodex({ reviewRequested: false, verifications: [] }), false);
});

test("changedPaths includes deleted files and the old name of renamed files", async () => {
  const github = {
    list: async () => [
      { filename: "apps/wiki/app/routes/old.tsx", status: "removed" },
      {
        filename: "apps/ost/app/b.tsx",
        previous_filename: "apps/ost/app/a.tsx",
        status: "renamed",
      },
    ],
  };
  const repo = new ReviewRepository({ github, repository: "gdg-jp/gdgjp" });
  assert.deepEqual(await repo.changedPaths(7), [
    ["apps/wiki/app/routes/old.tsx"],
    ["apps/ost/app/b.tsx", "apps/ost/app/a.tsx"],
  ]);
});

test("registryLockfile accepts only npm registry resolutions in pnpm's plain format", () => {
  const ok =
    "packages:\n\n  '@a/b@1.0.0':\n    resolution: {integrity: sha512-AAAA+/==}\n    engines: {node: '>=18'}\n    deprecated: |-\n      text: with \"anything\" \\ #\n";
  assert.equal(registryLockfile(ok), ok);
  assert.ok(registryLockfile(readFileSync(join(root, "pnpm-lock.yaml"), "utf8")).length > 0);
  for (const lines of [
    "    resolution: {tarball: http://169.254.169.254/latest}",
    "    resolution: {integrity: sha512-AA==, tarball: https://evil.example/a.tgz}",
    "    resolution: {type: git, repo: https://evil.example/a.git, commit: abc}",
    "    resolution:\n      tarball: http://169.254.169.254/",
    "    'resolution': {tarball: http://169.254.169.254/}",
    "    'resolutio''n': {tarball: http://169.254.169.254/}",
    '    "resolution": {tarball: http://169.254.169.254/}',
    '    "\\x72esolution": {tarball: http://169.254.169.254/}',
    "    resolution : {tarball: http://169.254.169.254/}",
    "    ? resolution\n    : {tarball: http://169.254.169.254/}",
    "  '@c/d@1.0.0': {resolution: {tarball: http://169.254.169.254/}}",
    "    <<: *evil",
    "    <<: {tarball: http://169.254.169.254/}",
    "    engines: {node: '>=18', resolution: {tarball: x}}",
    "    cpu: [{resolution: x}]",
    "    x: &a {tarball: http://169.254.169.254/}",
    "    x: !!map {tarball: http://169.254.169.254/}",
    "---",
    "    deprecated: |-\n      text\r    resolution: {tarball: http://169.254.169.254/}",
    "    deprecated: |-\n      text\u0085    resolution: {tarball: http://169.254.169.254/}",
    "    deprecated: |-\n      text\u2028    resolution: {tarball: http://169.254.169.254/}",
  ]) {
    assert.throws(
      () => registryLockfile(`${ok}  '@c/d@1.0.0':\n${lines}\n`),
      /outside the npm registry|pnpm's plain format|line break other than LF/,
      lines,
    );
  }
});
