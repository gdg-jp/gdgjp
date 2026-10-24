// Runs the design harness (packages/design-system/DESIGN.md "## Harness") from the monorepo.
//
//   scenarios                    `design:check` for every scenario in design/scenarios/
//   source --staged              static source rules on staged app TSX (Git index content)
//   source --diff BASE HEAD      static source rules on app TSX changed between two commits
//   source FILE...               static source rules on the given app TSX files
//
// Source rules only cover changed files: existing app code predates the harness, so a file
// must satisfy the rules once it is touched (a ratchet), not before.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = process.cwd();
const UI_DIRECTORY = "packages/design-system";
const appSourcePattern = /^apps\/[^/]+\/app\/.+\.tsx$/;
const testSourcePattern = /\.(?:test|spec)\.tsx$/;

export function isDesignSourceFile(path) {
  return appSourcePattern.test(path) && !testSourcePattern.test(path);
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout;
}

function changedPaths(args, cwd) {
  return git(["diff", "--name-only", "-z", "--no-renames", "--diff-filter=ACMRTUXB", ...args], cwd)
    .split("\0")
    .filter(Boolean);
}

export function parseArgs(args) {
  const [command, ...rest] = args;
  if (command === "scenarios") {
    for (const argument of rest) {
      if (argument !== "--skip-build") throw new Error(`Unknown option: ${argument}`);
    }
    return { command, skipBuild: rest.includes("--skip-build") };
  }
  if (command === "source") {
    if (rest[0] === "--staged" && rest.length === 1) return { command, mode: "staged" };
    if (rest[0] === "--diff") {
      if (rest.length !== 3) throw new Error("--diff requires BASE and HEAD");
      return { command, mode: "diff", base: rest[1], head: rest[2] };
    }
    const unknown = rest.find((argument) => argument.startsWith("--"));
    if (unknown) throw new Error(`Unknown option: ${unknown}`);
    return { command, mode: "files", files: rest };
  }
  throw new Error(
    "Usage: check-design-harness.mjs scenarios [--skip-build] | source (--staged | --diff BASE HEAD | FILE...)",
  );
}

export function scenarioIds(cwd = repositoryRoot) {
  const directory = join(cwd, UI_DIRECTORY, "design/scenarios");
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")).id);
}

function runScenarios({ skipBuild }, cwd) {
  let failed = false;
  for (const id of scenarioIds(cwd)) {
    console.log(`design-harness: ${id}`);
    const result = spawnSync(
      process.execPath,
      ["harness/cli.mjs", "check", id, ...(skipBuild ? ["--skip-build"] : [])],
      { cwd: join(cwd, UI_DIRECTORY), stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) failed = true;
  }
  return failed ? 1 : 0;
}

async function runSource(options, cwd) {
  const paths =
    options.mode === "staged"
      ? changedPaths(["--cached"], cwd)
      : options.mode === "diff"
        ? changedPaths([options.base, options.head], cwd)
        : options.files;
  const files = paths.filter(isDesignSourceFile);
  if (files.length === 0) return 0;

  const harnessUrl = (path) => pathToFileURL(join(cwd, UI_DIRECTORY, "harness", path)).href;
  const { loadHarness } = await import(harnessUrl("core.mjs"));
  const { checkSource } = await import(harnessUrl("source-check.mjs"));
  const harness = loadHarness(join(cwd, UI_DIRECTORY));
  const read = (path) =>
    options.mode === "staged"
      ? git(["show", `:${path}`], cwd)
      : options.mode === "diff"
        ? git(["show", `${options.head}:${path}`], cwd)
        : readFileSync(resolve(cwd, path), "utf8");

  let violations = 0;
  for (const filename of files) {
    if (options.mode === "files" && !existsSync(resolve(cwd, filename))) continue;
    const result = checkSource(harness, { source: read(filename), filename });
    for (const violation of result.violations) {
      violations += 1;
      console.error(
        `design-harness error: ${violation.location} ${violation.rule}: ${violation.observation}`,
      );
      if (violation.nextAction) console.error(`  fix: ${violation.nextAction}`);
    }
  }
  if (violations > 0) {
    console.error(
      `design-harness: ${violations} violation(s) in ${files.length} changed app file(s).`,
    );
    console.error("design-harness: rules live in packages/design-system/design/rules.json.");
  }
  return violations > 0 ? 1 : 0;
}

export async function run(args = process.argv.slice(2), cwd = repositoryRoot) {
  const options = parseArgs(args);
  return options.command === "scenarios" ? runScenarios(options, cwd) : runSource(options, cwd);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await run();
  } catch (error) {
    console.error(
      `design-harness error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
