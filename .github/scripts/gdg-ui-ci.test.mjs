import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { parse as parseYaml } from "yaml";
import { changedSteps, completeSteps, shellQuote } from "../../scripts/run-ci.mjs";
import { classifyChanges } from "./changed-workspaces.mjs";

function assertIncludes(command, expected) {
  assert.ok(command.includes(expected), `${command}\n  does not include ${expected}`);
}

function readWorkflow(name) {
  return parseYaml(readFileSync(new URL(`../workflows/${name}`, import.meta.url), "utf8"));
}

function allSteps(job) {
  return job.steps.flatMap((step) => step.parallel ?? [step]);
}

function stepByName(job, name) {
  return job.steps.find((step) => step.name === name);
}

test("PR E2E preparation and source edits use the isolated package runner", () => {
  for (const path of [
    "apps/pr/e2e/run.mjs",
    "apps/pr/e2e/fonts.ts",
    "apps/pr/e2e/global-setup.ts",
    "apps/pr/app/lib/crypto.server.ts",
  ]) {
    const step = changedSteps("full", [path]).find(([name]) => name === "e2e:@gdgjp/pr");
    assert.equal(
      step?.[1],
      "node scripts/run-isolated-e2e.mjs --workspace @gdgjp/pr -- --reporter=dot,json",
    );
    if (!path.includes("/app/")) {
      assert.equal(classifyChanges([path]).scriptTests, true);
      assert.match(
        changedSteps("full", [path]).find(([name]) => name === "test:scripts")?.[1] ?? "",
        /pr-e2e-isolation\.test\.mjs/,
      );
    }
  }
});

test("documentation edits run their checker locally and in hosted CI", () => {
  for (const mode of ["quick", "full"]) {
    assert.ok(completeSteps(mode).some(([name]) => name === "docs"));
    assert.ok(changedSteps(mode, ["docs/README.md"]).some(([name]) => name === "docs"));
  }
  const job = readWorkflow("ci.yml").jobs["code-comments"];
  assert.equal(job.if, undefined);
  assert.equal(
    stepByName(job, "Check documentation layout and links").run,
    "node scripts/check-docs.mjs",
  );
});

test("workspace boundaries run for source and resolution changes in every delivery path", () => {
  for (const mode of ["quick", "full"]) {
    assert.ok(completeSteps(mode).some(([name]) => name === "workspace-boundaries"));
    for (const file of [
      "apps/wiki/app/root.tsx",
      "apps/wiki/tsconfig.json",
      "packages/gdg-lib/package.json",
      "packages/design-system",
      "tsconfig.base.json",
      "pnpm-workspace.yaml",
      "package.json",
      "scripts/check-workspace-boundaries.mjs",
      ".github/scripts/check-workspace-boundaries.test.mjs",
    ]) {
      const step = changedSteps(mode, [file]).find(([name]) => name === "workspace-boundaries");
      assert.equal(step?.[1], "node scripts/check-workspace-boundaries.mjs", file);
    }
  }
  assert.equal(classifyChanges(["scripts/check-workspace-boundaries.mjs"]).scriptTests, true);
  assert.match(
    changedSteps("quick", ["scripts/check-workspace-boundaries.mjs"]).find(
      ([name]) => name === "test:scripts",
    )?.[1] ?? "",
    /check-workspace-boundaries\.test\.mjs/,
  );
  const job = readWorkflow("ci.yml").jobs["code-comments"];
  assert.equal(job.if, undefined);
  assert.equal(
    stepByName(job, "Check workspace import boundaries").run,
    "node scripts/check-workspace-boundaries.mjs",
  );
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.match(manifest.scripts.lint, /node scripts\/check-workspace-boundaries\.mjs/);
});

test("comment policy runs for first-party changes locally and for every hosted change", () => {
  for (const path of ["apps/wiki/app/root.tsx", "apps/cli/cmd/gdg/main.go"]) {
    assert.ok(
      changedSteps("quick", [path]).some(
        ([name, command]) => name === "code-comments" && command.endsWith(" --staged"),
      ),
    );
  }
  for (const mode of ["quick", "full"]) {
    assert.ok(completeSteps(mode).some(([name]) => name === "code-comments"));
  }
  const job = readWorkflow("ci.yml").jobs["code-comments"];
  assert.equal(job.if, undefined);
  assert.equal(job.steps[0].with["fetch-depth"], 0);
  const check = stepByName(job, "Reject new code comments");
  assert.equal(check.env.BASE_SHA, "${{ needs.changes.outputs.base }}");
  assert.equal(check.env.HEAD_SHA, "${{ needs.changes.outputs.head }}");
  assert.equal(check.run, 'node scripts/check-code-comments.mjs --diff "$BASE_SHA" "$HEAD_SHA"');
});

test("CSS-only UI changes trigger build, behavior tests and visual checks", () => {
  const steps = changedSteps("full", ["packages/design-system/src/styles/tokens.css"]);
  const commands = steps.map(([, command]) => command).join("\n");
  assert.match(commands, /--filter=@gdgjp\/design-system/);
  assert.match(commands, /turbo typecheck test test:e2e:browser --filter=@gdgjp\/design-system/);
  assert.doesNotMatch(commands, /--filter=@gdgjp\/tinyurl/);
});

test("UI font changes are validated even without a TypeScript edit", () => {
  const names = changedSteps("full", ["packages/design-system/assets/fonts/GoogleSans.woff2"]).map(
    ([name]) => name,
  );
  assert.ok(!names.includes("build"));
  assert.ok(!names.includes("test:ui"));
  assert.ok(names.includes("e2e:ui"));
  assert.ok(
    changedSteps("quick", ["packages/design-system/assets/fonts/GoogleSans.woff2"]).some(([name]) =>
      name.includes("build"),
    ),
  );
  const pkg = JSON.parse(
    readFileSync(new URL("../../packages/design-system/package.json", import.meta.url), "utf8"),
  );
  assert.match(pkg.scripts["test:e2e"], /^pnpm build && pnpm test:consumer &&/);
});

test("UI E2E edits run the suite once and unrelated apps retain related tests", () => {
  const steps = changedSteps("full", [
    "packages/design-system/e2e/library.spec.ts",
    "apps/tinyurl/app/lib/utils.ts",
  ]);
  assert.equal(steps.filter(([name]) => name === "e2e:ui").length, 1);
  assert.ok(steps.some(([, command]) => command.includes("@gdgjp/tinyurl exec vitest related")));
});

test("UI unit-test-only changes keep typechecking and related tests without unrelated browsers", () => {
  const steps = changedSteps("full", ["packages/design-system/src/index.test.tsx"]);
  assert.deepEqual(
    steps.map(([name]) => name),
    ["workspace-boundaries", "lint:ui", "typecheck", "test:ui"],
  );
  assertIncludes(
    steps.find(([name]) => name === "test:ui")[1],
    `vitest related --run --reporter=minimal ${shellQuote("src/index.test.tsx")}`,
  );
  for (const extra of [
    "packages/design-system/src/index.ts",
    "packages/design-system/src/styles/tokens.css",
    "packages/design-system/vitest.config.ts",
    "packages/design-system/pnpm-lock.yaml",
    "packages/design-system/e2e/library.spec.ts-snapshots/catalog.png",
    "packages/design-system/src/index.test.js",
  ]) {
    assert.ok(
      changedSteps("full", ["packages/design-system/src/index.test.tsx", extra]).some(
        ([name]) => name === "e2e:ui",
      ),
    );
  }
});

test("UI E2E spec-only edits select those specs, while shared inputs keep the full suite", () => {
  const selection = (files) =>
    JSON.parse(changedSteps("full", files).find(([name]) => name === "e2e:ui")[2].GDG_UI_E2E_FILES);
  assert.deepEqual(selection(["packages/design-system/e2e/slider.spec.ts"]), [
    "e2e/slider.spec.ts",
  ]);
  for (const extra of [
    "packages/design-system/src/index.ts",
    "packages/design-system/src/styles/tokens.css",
    "packages/design-system/e2e/fixtures.ts",
    "packages/design-system/playwright.config.ts",
  ]) {
    assert.deepEqual(selection(["packages/design-system/e2e/slider.spec.ts", extra]), []);
  }
  assert.deepEqual(selection(["packages/design-system/e2e/deleted.spec.ts"]), []);
  const { tasks } = JSON.parse(readFileSync(new URL("../../turbo.json", import.meta.url), "utf8"));
  assert.ok(tasks["@gdgjp/design-system#test:e2e:browser"].env.includes("GDG_UI_E2E_FILES"));
});

test("unit-test-only changes keep typecheck and related tests without production builds or E2E", () => {
  for (const file of [
    "apps/roster/app/features/demand/impact.test.ts",
    "apps/wiki/app/features/pages/__tests__/page.tsx",
  ]) {
    const steps = changedSteps("full", [file]);
    assert.ok(steps.some(([name]) => name === "typecheck"));
    assert.ok(steps.some(([, command]) => command.includes("vitest related")));
    assert.ok(steps.every(([name]) => name !== "build" && !name.startsWith("e2e:")));
  }
  const steps = changedSteps("full", [
    "apps/roster/app/features/demand/impact.test.ts",
    "apps/roster/app/features/demand/impact.ts",
  ]);
  assert.ok(steps.some(([name]) => name === "typecheck+build"));
  assert.ok(steps.some(([name]) => name === "e2e:@gdgjp/roster"));
});

test("frontend edits without a configured browser suite retain other checks", () => {
  for (const app of ["agent", "mcp"]) {
    const steps = changedSteps("full", [`apps/${app}/src/index.ts`]);
    assert.ok(steps.some(([name]) => name === "typecheck+build"));
    assert.ok(steps.some(([name]) => name.startsWith("test:")));
    assert.ok(steps.some(([name]) => name.includes("build")));
    assert.ok(steps.every(([name]) => !name.startsWith("e2e:")));
  }
});

test("Pay frontend and browser harness changes select its browser suite", () => {
  for (const file of [
    "apps/pay/app/root.tsx",
    "apps/pay/e2e/ui.spec.ts",
    "apps/pay/e2e/ui-harness.tsx",
    "apps/pay/playwright.config.ts",
  ]) {
    const steps = changedSteps("full", [file]);
    assert.ok(steps.some(([name]) => name === "e2e:@gdgjp/pay"));
  }
});

test("staged typechecks and builds share dependencies without widening test-only changes", () => {
  const steps = changedSteps("full", [
    "apps/roster/app/features/demand/impact.ts",
    "apps/tinyurl/app/lib/utils.test.ts",
  ]);
  const graph = steps.find(([name]) => name === "typecheck+build");
  assert.ok(graph);
  assertIncludes(graph[1], shellQuote("@gdgjp/roster#typecheck"));
  assertIncludes(graph[1], shellQuote("@gdgjp/tinyurl#typecheck"));
  assertIncludes(graph[1], shellQuote("@gdgjp/roster#build"));
  assert.doesNotMatch(graph[1], /@gdgjp\/tinyurl#build/);
  assert.ok(steps.every(([name]) => name !== "typecheck" && name !== "build"));
  assert.ok(steps.some(([name]) => name === "e2e:@gdgjp/roster"));
});

test("the selected runtime covers applications", () => {
  const steps = changedSteps("full", ["apps/wiki/app/root.tsx"]);
  const preparation = steps.find(([name]) => name === "typecheck+build")[2];
  const browser = steps.find(([name]) => name === "e2e:@gdgjp/wiki")[2];
  assert.ok(preparation.PATH);
  assert.equal(browser.GDG_CI_RUNTIME, preparation.GDG_CI_RUNTIME);
  assert.equal(browser.CI, "true");
  assert.equal(
    steps.find(([name]) => name === "test:@gdgjp/wiki")[2].GDG_CI_RUNTIME,
    preparation.GDG_CI_RUNTIME,
  );
});

function collectDeploymentFixture(t, pages, apiExit = 0) {
  const directory = mkdtempSync(join(tmpdir(), "gdgjp-deploy-observations-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = join(directory, "bin");
  mkdirSync(bin);
  const argumentsPath = join(directory, "gh-args.json");
  writeFileSync(
    join(bin, "date"),
    `#!${process.execPath}\nprocess.stdout.write("2026-11-17T00:00:00Z\\n");\n`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(bin, "gh"),
    `#!${process.execPath}
import { writeFileSync } from "node:fs";
writeFileSync(process.env.FIXTURE_GH_ARGS, JSON.stringify(process.argv.slice(2)));
process.stdout.write(process.env.FIXTURE_DEPLOY_PAGES);
process.exit(Number(process.env.FIXTURE_GH_EXIT));
`,
    { mode: 0o700 },
  );
  const script = stepByName(
    readWorkflow("ci.yml").jobs.observations,
    "Collect deployment attempts",
  ).run;
  const run = spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      GITHUB_REPOSITORY: "fixture/repository",
      FIXTURE_GH_ARGS: argumentsPath,
      FIXTURE_GH_EXIT: String(apiExit),
      FIXTURE_DEPLOY_PAGES: JSON.stringify(pages),
    },
  });
  return {
    run,
    args: JSON.parse(readFileSync(argumentsPath, "utf8")),
    directory,
    bin,
    output: join(directory, "local_data/pstack/engineering-health"),
  };
}

function recordDeploymentFixture(fixture) {
  mkdirSync(join(fixture.directory, "scripts"));
  writeFileSync(
    join(fixture.directory, "scripts/engineering-health.mjs"),
    'import { writeFileSync } from "node:fs"; writeFileSync("health-arguments.json", JSON.stringify(process.argv.slice(2)));',
  );
  const run = spawnSync(
    "bash",
    [
      "-e",
      "-o",
      "pipefail",
      "-c",
      stepByName(readWorkflow("ci.yml").jobs.observations, "Record engineering observations").run,
    ],
    {
      cwd: fixture.directory,
      encoding: "utf8",
      env: { ...process.env, PATH: `${fixture.bin}${delimiter}${process.env.PATH}` },
    },
  );
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(readFileSync(join(fixture.directory, "health-arguments.json"), "utf8"));
}

test("hosted deployment collection preserves complete and incomplete pagination", (t) => {
  for (const [pages, complete] of [
    [
      [
        { total_count: 2, workflow_runs: [{ id: 1 }] },
        { total_count: 2, workflow_runs: [{ id: 2 }] },
      ],
      true,
    ],
    [[{ total_count: 3, workflow_runs: [{ id: 1 }, { id: 2 }] }], false],
    [[{ total_count: 2, workflow_runs: [{ id: 1 }, { id: 1 }] }], false],
    [
      [
        { total_count: 2, workflow_runs: [{ id: 1 }] },
        { total_count: 3, workflow_runs: [{ id: 2 }] },
      ],
      false,
    ],
    [[{ total_count: 0, workflow_runs: [] }], true],
  ]) {
    const fixture = collectDeploymentFixture(t, pages);
    assert.equal(fixture.run.status, 0, fixture.run.stderr);
    assert.deepEqual(fixture.args.slice(0, 3), ["api", "--paginate", "--slurp"]);
    assert.match(
      fixture.args[3],
      /^repos\/fixture\/repository\/actions\/workflows\/deploy\.yml\/runs\?created=>=.+&per_page=100$/,
    );
    const result = JSON.parse(readFileSync(join(fixture.output, "deploy-runs.json"), "utf8"));
    assert.equal(result.complete, complete);
    assert.equal(result.workflow_runs.length, pages.flatMap((page) => page.workflow_runs).length);
    assert.equal(result.source, "github-api:fixture/repository/actions/workflows/deploy.yml/runs");
    assert.ok(Number.isFinite(Date.parse(result.collectedAt)));
    assert.ok(recordDeploymentFixture(fixture).includes("--deploy-runs"));
  }
});

test("failed hosted deployment collection records unavailable data without an empty success export", (t) => {
  const fixture = collectDeploymentFixture(t, [], 1);
  assert.equal(fixture.run.status, 1, fixture.run.stderr);
  assert.equal(existsSync(join(fixture.output, "deploy-runs.json")), false);
  assert.deepEqual(
    JSON.parse(readFileSync(join(fixture.output, "deploy-collection.json"), "utf8")),
    { status: "unavailable", reason: "GitHub deployment history collection failed" },
  );
  assert.equal(recordDeploymentFixture(fixture).includes("--deploy-runs"), false);
});

test("staged UI E2E uses isolated runs, while stateful application E2E stays uncached", () => {
  const ui = changedSteps("full", ["packages/design-system"]).find(([name]) => name === "e2e:ui");
  assert.equal(ui[2].CI, "true");
  assert.match(ui[1], /turbo typecheck test test:e2e:browser/);
  const config = JSON.parse(readFileSync(new URL("../../turbo.json", import.meta.url), "utf8"));
  assert.equal(config.tasks["test:e2e"].cache, false);
  assert.equal(config.tasks["@gdgjp/design-system#test:e2e:browser"].cache, true);
  assert.ok(config.tasks["@gdgjp/design-system#test:e2e:browser"].env.includes("CI"));
  assert.ok(config.globalEnv.includes("GDG_CI_RUNTIME"));
  for (const workspace of ["roster", "connpass"]) {
    const step = changedSteps("full", [`apps/${workspace}/app/root.tsx`]).find(([name]) =>
      name.startsWith("e2e:"),
    );
    assert.equal(
      step[1],
      `node scripts/run-isolated-e2e.mjs --workspace @gdgjp/${workspace} -- --reporter=dot,json`,
    );
  }
});

test("Wiki E2E specs and setup changes select the Wiki suite", () => {
  const specSteps = changedSteps("full", ["apps/wiki/tests/e2e/access-control.spec.ts"]);
  const setupSteps = changedSteps("full", ["apps/wiki/tests/e2e/setup.ts"]);
  const appSteps = changedSteps("full", ["apps/wiki/app/root.tsx"]);

  assert.equal(specSteps.filter(([name]) => name === "e2e:@gdgjp/wiki").length, 1);
  assert.match(
    specSteps.find(([name]) => name === "e2e:@gdgjp/wiki")[1],
    /access-control\.spec\.ts/,
  );
  assert.equal(setupSteps.filter(([name]) => name === "e2e:@gdgjp/wiki").length, 1);
  assert.match(
    setupSteps.find(([name]) => name === "e2e:@gdgjp/wiki")[1],
    /run-isolated-e2e\.mjs --workspace @gdgjp\/wiki --/,
  );
  assert.doesNotMatch(setupSteps.find(([name]) => name === "e2e:@gdgjp/wiki")[1], /access-control/);
  assert.equal(appSteps.filter(([name]) => name === "e2e:@gdgjp/wiki").length, 1);
  assert.equal(appSteps.find(([name]) => name === "e2e:@gdgjp/wiki")[2].GDG_E2E_BUILT, undefined);
  assert.equal(specSteps.find(([name]) => name === "e2e:@gdgjp/wiki")[2].GDG_E2E_BUILT, undefined);
  assert.ok(
    changedSteps("full", ["apps/wiki/react-router.config.ts"]).some(
      ([name]) => name === "e2e:@gdgjp/wiki",
    ),
  );
});

test("full CI schedules the Wiki E2E target once", () => {
  const steps = completeSteps("full");
  assert.equal(steps.filter(([name]) => name === "e2e:@gdgjp/wiki").length, 1);
  assert.equal(
    steps.filter(([name]) => name.startsWith("e2e")).length,
    classifyChanges([], { forceAll: true }).e2e.length,
  );
  assert.ok(steps.find(([name]) => name === "typecheck+build")[2].PATH);
  assert.ok(steps.find(([name]) => name === "test")[2].PATH);
  for (const app of ["wiki", "accounts", "scheduler", "tinyurl", "img", "pay"]) {
    assert.equal(steps.find(([name]) => name === `e2e:@gdgjp/${app}`)[2].GDG_E2E_BUILT, undefined);
  }
  const names = steps.map(([name]) => name);
  assert.ok(names.indexOf("typecheck+build") < names.indexOf("prepare:e2e:ui"));
  assert.ok(names.indexOf("prepare:e2e:ui") < names.indexOf("e2e:@gdgjp/design-system"));
  assert.equal(
    readWorkflow("ci.yml").jobs.e2e.strategy.matrix.app,
    "${{ fromJSON(needs.changes.outputs.e2e) }}",
  );
});

test("Worker build configuration edits select their own E2E using freshly built artifacts", () => {
  for (const app of ["tinyurl", "img", "scheduler"]) {
    for (const file of ["vite.config.ts", "react-router.config.ts", "package.json"]) {
      const steps = changedSteps("full", [`apps/${app}/${file}`]);
      const browsers = steps.filter(([name]) => name.startsWith("e2e:"));
      assert.equal(browsers.length, 1);
      assert.equal(browsers[0][0], `e2e:@gdgjp/${app}`);
      assert.equal(browsers[0][2].GDG_E2E_BUILT, undefined);
    }
  }
});

test("Go runner edits select its execution and regression tests", () => {
  const steps = changedSteps("full", ["scripts/run-go-ci.mjs"]);
  assert.ok(steps.some(([name, command]) => name === "go" && command.includes("run-go-ci.mjs")));
  assert.match(steps.find(([name]) => name === "test:scripts")[1], /ci-metrics\.test\.mjs/);
});

test("repository script edits do not run every workspace's checks", () => {
  const steps = changedSteps("full", [".github/scripts/workflows.test.mjs"]);
  const commands = steps.map(([, command]) => command).join("\n");

  assertIncludes(
    commands,
    `node --test --test-reporter=dot ${shellQuote(".github/scripts/workflows.test.mjs")}`,
  );
  assert.doesNotMatch(commands, /turbo typecheck/);
  assert.doesNotMatch(commands, /turbo build/);
});

test("global configuration edits do not expand changed CI to every workspace", () => {
  const commands = changedSteps("full", ["package.json"])
    .map(([, command]) => command)
    .join("\n");

  assert.match(commands, /biome check --staged/);
  assert.doesNotMatch(commands, /turbo typecheck/);
  assert.doesNotMatch(commands, /turbo build/);
});

test("changed CI does not unconditionally typecheck unrelated Node scripts", () => {
  const steps = changedSteps("full", [".github/scripts/workflows.test.mjs"]);
  assert.ok(steps.every(([name]) => name !== "typecheck:node-scripts"));

  const packageJSON = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.equal(packageJSON.scripts["ci:quick"], "node scripts/run-ci.mjs quick");
  assert.equal(packageJSON.scripts["ci:full"], "node scripts/run-ci.mjs full");
  assert.equal(packageJSON.scripts["ci:staged"], "node scripts/run-ci.mjs full --changed");
});

test("hosted CI builds UI before every clean consumer job", () => {
  const workflow = readWorkflow("ci.yml");
  for (const jobName of ["typecheck", "test", "build"]) {
    const job = workflow.jobs[jobName];
    const sharedBuildIndex = job.steps.findIndex(
      (step) =>
        step.name === "Build shared UI dependency" &&
        step.run === "pnpm --filter @gdgjp/design-system build",
    );
    assert.notEqual(sharedBuildIndex, -1, `${jobName} must build the shared UI package`);
    assert.equal(
      job.steps.filter((step) => step.name === "Build shared UI dependency").length,
      1,
      `${jobName} must build UI once`,
    );
    const flattened = allSteps(job);
    if (jobName === "e2e") {
      const e2eIndex = flattened.findIndex((step) => step.name === "Run E2E testing");
      assert.ok(e2eIndex > sharedBuildIndex, "E2E must start after the shared UI build");
      continue;
    }
    const consumerIndex = flattened.findIndex(
      (step) => step.run === `node .github/scripts/run-affected.mjs ${jobName}`,
    );
    assert.ok(consumerIndex > sharedBuildIndex, `${jobName} runs after the UI dependency build`);
  }
  assert.equal(
    stepByName(workflow.jobs.build, "Build GDG UI consumer").run,
    "pnpm --filter @gdgjp/design-system test:consumer",
  );
});

test("hosted E2E delegates fixtures, builds and report retention to the isolated runner", () => {
  const job = readWorkflow("ci.yml").jobs.e2e;
  assert.equal(
    stepByName(job, "Run E2E testing").run,
    "pnpm test:e2e --workspace @gdgjp/${{ matrix.app }}",
  );
  assert.equal(job.strategy["fail-fast"], false);
  assert.equal(stepByName(job, "Upload Playwright report").if, "always()");
  assert.equal(stepByName(job, "Upload Playwright report").with.path, "local_data/pstack/e2e/");
  assert.doesNotMatch(
    JSON.stringify(job),
    /continue-on-error|\.dev\.vars|migrate:local|e2e:prepare/,
  );
  assert.equal(stepByName(job, "Build shared UI dependency"), undefined);
});

test("job lifecycle verification is selected across local and hosted delivery", () => {
  const inputs = [
    "apps/wiki/app/features/jobs/lease.server.ts",
    "apps/wiki/app/routes/api/runner/jobs-result.ts",
    "apps/wiki/app/db/schema/jobs.ts",
    "apps/wiki/app/features/spaces/test-db.ts",
    "apps/wiki/app/features/agent-api/runner-identity.server.ts",
    "apps/wiki/migrations/0074_jobs.sql",
    "apps/cli/internal/wiki/runner/jobs.go",
    "apps/cli/internal/pr/runner/runner.go",
    ".agents/skills/verify-job-lifecycle/coverage.json",
    "scripts/verification/workspace-snapshot.mjs",
    "pnpm-lock.yaml",
  ];
  for (const mode of ["quick", "full"]) {
    for (const path of inputs) {
      const selected = changedSteps(mode, [path]);
      const verifier = selected.find(([name]) => name === "job-lifecycle");
      assert.match(verifier?.[1] ?? "", /verify-job-lifecycle\/scripts\/verify\.mjs/);
      assert.match(
        verifier?.[1] ?? "",
        /node --test .*verify-job-lifecycle\/scripts\/verify\.test\.mjs/,
      );
      assert.equal(classifyChanges([path]).jobLifecycle, true, path);
      assert.equal(verifier[1].endsWith(" --mutation-proof"), mode === "full");
    }
    assert.ok(completeSteps(mode).some(([name]) => name === "job-lifecycle"));
  }
  const coverage = JSON.parse(
    readFileSync(
      new URL("../../.agents/skills/verify-job-lifecycle/coverage.json", import.meta.url),
      "utf8",
    ),
  );
  for (const source of coverage.sources) {
    assert.equal(classifyChanges([source.path]).jobLifecycle, true, source.path);
  }
  assert.equal(
    classifyChanges(["apps/wiki/app/features/comments/comments.server.ts"]).jobLifecycle,
    false,
  );
  assert.ok(!changedSteps("full", ["docs/README.md"]).some(([name]) => name === "job-lifecycle"));
  const workflow = readWorkflow("ci.yml");
  assert.equal(
    workflow.jobs.changes.outputs["job-lifecycle"],
    "${{ steps.changes.outputs.job-lifecycle }}",
  );
  const job = workflow.jobs["job-lifecycle"];
  assert.equal(job.if, "needs.changes.outputs.job-lifecycle == 'true'");
  assert.ok(job.steps.some((step) => step.uses === "actions/setup-go@v5"));
  assert.ok(
    job.steps.some(
      (step) =>
        step.run?.includes(
          "node --test .agents/skills/verify-job-lifecycle/scripts/verify.test.mjs",
        ) &&
        step.run.includes(
          "node .agents/skills/verify-job-lifecycle/scripts/verify.mjs --mutation-proof",
        ),
    ),
  );
});

test("hosted engineering observations run after failures and preserve missing-source status", () => {
  const workflow = readWorkflow("ci.yml");
  const job = workflow.jobs.observations;
  assert.equal(job.if, "always()");
  const expected = Object.keys(workflow.jobs)
    .filter((name) => name !== "observations")
    .sort();
  assert.deepEqual([...job.needs].sort(), expected);
  assert.equal(job.steps[0].with["fetch-depth"], 0);
  assert.deepEqual(job.permissions, { contents: "read", actions: "read" });
  assert.equal(stepByName(job, "Collect deployment attempts").env.GH_TOKEN, "${{ github.token }}");
  assert.equal(stepByName(job, "Record engineering observations").if, "always()");
  assert.match(
    stepByName(job, "Record engineering observations").run,
    /node scripts\/engineering-health\.mjs --since/,
  );
  assert.doesNotMatch(JSON.stringify(job), /continue-on-error|production-rum|synthetic-navigation/);
  assert.equal(stepByName(job, "Upload engineering observations").if, "always()");
  assert.equal(
    stepByName(job, "Upload engineering observations").with.path,
    "local_data/pstack/engineering-health/",
  );
});

test("deploy builds shared UI before its parallel application builds", () => {
  const workflow = readWorkflow("deploy.yml");
  const job = workflow.jobs.deploy;
  const sharedBuildIndex = job.steps.findIndex(
    (step) => step.name === "Build shared UI dependency",
  );
  const parallelIndex = job.steps.findIndex((step) => Array.isArray(step.parallel));
  assert.ok(sharedBuildIndex >= 0);
  assert.ok(parallelIndex > sharedBuildIndex);
  const parallel = job.steps.find((step) => Array.isArray(step.parallel)).parallel;
  const wiki = parallel.find((step) => step.name === "Build, deploy, and migrate wiki");
  assert.equal(
    wiki.run.indexOf("pnpm --filter @gdgjp/wiki build") <
      wiki.run.indexOf("pnpm --filter @gdgjp/wiki run deploy"),
    true,
  );
  assert.equal(
    wiki.run.indexOf("pnpm --filter @gdgjp/wiki run deploy") <
      wiki.run.indexOf("pnpm --filter @gdgjp/wiki migrate:remote"),
    true,
  );
});

test("UI gitlink updates run local library checks", () => {
  const steps = changedSteps("full", ["packages/design-system"]);
  assert.deepEqual(
    steps.map(([name]) => name),
    ["workspace-boundaries", "design-harness:scenarios", "e2e:ui"],
  );
  const scenarios = steps.find(([name]) => name === "design-harness:scenarios");
  const browser = steps.find(([name]) => name === "e2e:ui");
  assert.match(
    scenarios[1],
    /turbo test:consumer .*&& node scripts\/check-design-harness\.mjs scenarios$/,
  );
  assert.equal(scenarios[2].CI, "true");
  assert.match(browser[1], /turbo typecheck test test:e2e:browser/);
  assert.ok(steps.indexOf(scenarios) < steps.indexOf(browser));
  const { tasks } = JSON.parse(readFileSync(new URL("../../turbo.json", import.meta.url), "utf8"));
  assert.deepEqual(tasks["@gdgjp/design-system#test:e2e:browser"].dependsOn, [
    "typecheck",
    "test:consumer",
    "build:storybook:test",
  ]);
  assert.deepEqual(tasks["@gdgjp/design-system#test:consumer"].dependsOn, ["build:e2e"]);
  assert.equal(tasks["@gdgjp/design-system#build:storybook:test"].dependsOn, undefined);
  assert.deepEqual(tasks["@gdgjp/design-system#test:consumer"].outputs, [
    "build/consumer/**",
    "build/consumer-ssr.mjs",
  ]);
  const pkg = JSON.parse(
    readFileSync(new URL("../../packages/design-system/package.json", import.meta.url), "utf8"),
  );
  assert.equal(pkg.scripts["test:e2e:browser"], "playwright test");
});

test("UI test artifacts track their Vite environment and retain documentation entries", async () => {
  const { tasks } = JSON.parse(readFileSync(new URL("../../turbo.json", import.meta.url), "utf8"));
  for (const task of [
    "@gdgjp/design-system#build:storybook:test",
    "@gdgjp/design-system#test:consumer",
  ]) {
    assert.ok(tasks[task].inputs.includes(".env*"));
    assert.ok(tasks[task].env.includes("NODE_ENV"));
    assert.ok(tasks[task].env.includes("VITE_*"));
  }
  const { default: storybook } = await import("../../packages/design-system/.storybook/main.ts");
  assert.deepEqual(storybook.build.test.disabledAddons, []);
  for (const option of ["disableBlocks", "disableMDXEntries", "disableAutoDocs"]) {
    assert.equal(storybook.build.test[option], false);
  }
});

test("every package-installing job initializes the UI submodule first", () => {
  for (const workflowName of [
    "ci.yml",
    "deploy.yml",
    "gdg-lib-publish.yml",
    "google-photos-import.yml",
  ]) {
    for (const [jobName, job] of Object.entries(readWorkflow(workflowName).jobs)) {
      const installIndex =
        job.steps?.findIndex((step) => String(step.run ?? "").includes("pnpm install")) ?? -1;
      if (installIndex < 0) continue;
      const initIndex = job.steps.findIndex(
        (step) => step.run === "git submodule update --init packages/design-system",
      );
      assert.ok(initIndex >= 0 && initIndex < installIndex, `${workflowName}: ${jobName}`);
    }
  }
});
