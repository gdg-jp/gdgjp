#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const MUTATION_PROJECTS = ["packages/gdg-lib", "apps/accounts"];

const usage = `usage: node scripts/run-mutation.mjs [--since <ref>] [--project <dir>]... [-- <mutator args>]

Runs mutator in each mutation project (default: ${MUTATION_PROJECTS.join(", ")}).
With --since, only mutants in git diff <ref> run, and surviving or unreached mutants fail.
Without it, every mutant runs; critical regions still exit 2 while gaps remain.`;

export function parseArguments(args) {
  const options = { since: null, projects: [], extra: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      options.extra = args.slice(index + 1);
      break;
    }
    if (argument === "--since" || argument === "--project") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      if (argument === "--since") options.since = value;
      else options.projects.push(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}\n${usage}`);
  }
  for (const project of options.projects) {
    if (!MUTATION_PROJECTS.includes(project)) {
      throw new Error(`Not a mutation project: ${project}`);
    }
  }
  if (options.projects.length === 0) options.projects = [...MUTATION_PROJECTS];
  return options;
}

export function mutatorRuns({ since, projects, extra }) {
  const diff = since ? ["--since", since, "--fail-on-survived"] : [];
  return projects.map((project) => ["--root", project, ...diff, ...extra]);
}

export function run(args = process.argv.slice(2)) {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${usage}\n`);
    return 0;
  }
  const root = fileURLToPath(new URL("..", import.meta.url));
  const mutator = fileURLToPath(new URL("../node_modules/.bin/mutator", import.meta.url));
  let status = 0;
  for (const runArgs of mutatorRuns(parseArguments(args))) {
    process.stderr.write(`\n> mutator ${runArgs.join(" ")}\n`);
    const result = spawnSync(mutator, runArgs, { cwd: root, stdio: "inherit" });
    status = Math.max(status, result.status ?? 1);
  }
  return status;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
