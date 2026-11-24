import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPortsAvailable, runIsolatedE2E } from "../../../scripts/run-isolated-e2e.mjs";
import { createWorkspaceSnapshot } from "../../../scripts/verification/workspace-snapshot.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function loadMutations(file) {
  const mutations = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(mutations) || !mutations.length) throw new Error(`${file}: expected a list`);
  for (const mutation of mutations) {
    if (typeof mutation.replace !== "string")
      throw new Error(`${file}: mutation ${mutation.id ?? "?"} needs replace`);
    for (const key of ["id", "description", "workspace", "spec", "file", "find"])
      if (typeof mutation[key] !== "string" || !mutation[key])
        throw new Error(`${file}: mutation ${mutation.id ?? "?"} needs ${key}`);
    if (mutation.find === mutation.replace) throw new Error(`${mutation.id}: find equals replace`);
  }
  return mutations;
}

export function applyMutation(root, mutation) {
  const path = join(root, mutation.file);
  const source = readFileSync(path, "utf8");
  const count = source.split(mutation.find).length - 1;
  if (count !== 1)
    throw new Error(`${mutation.id}: expected one match in ${mutation.file}, found ${count}`);
  writeFileSync(path, source.replace(mutation.find, mutation.replace));
}

function readFailures(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")));
}

export function verdict(mutation, exitCode, failures) {
  const matching = failures.filter(
    (failure) =>
      (!mutation.expect?.property || failure.property === mutation.expect.property) &&
      (!mutation.expect?.violation ||
        `${failure.violation.kind}:${failure.violation.name}` === mutation.expect.violation),
  );
  if (exitCode !== 0 && matching.length) return "killed";
  if (exitCode !== 0) return "failed-without-property-violation";
  return "survived";
}

const PORTS = {
  "@gdgjp/wiki": [6177],
  "@gdgjp/pr": [6191, 5298, 5299],
  "@gdgjp/accounts": [6173, 6174],
  "@gdgjp/tinyurl": [6173, 6174],
  "@gdgjp/ost": [6185],
  "@gdgjp/screen": [6188],
  "@gdgjp/pay": [6182],
};

async function portsReleased(workspace) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await assertPortsAvailable(PORTS[workspace] ?? []);
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 2_000));
    }
  }
  await assertPortsAvailable(PORTS[workspace] ?? []);
}

export async function proveMutation(mutation, { evidenceRoot, playwrightArgs = [] }) {
  const snapshot = createWorkspaceSnapshot(repository);
  const failures = join(snapshot.root, ".ui-property-failures");
  try {
    const init = spawnSync("git", ["init", "-q"], { cwd: snapshot.root, encoding: "utf8" });
    if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
    applyMutation(snapshot.root, mutation);
    await portsReleased(mutation.workspace);
    const previous = process.env.UI_PROPERTY_FAILURES_DIR;
    process.env.UI_PROPERTY_FAILURES_DIR = failures;
    let exitCode;
    try {
      exitCode = await runIsolatedE2E({
        source: snapshot.root,
        workspace: mutation.workspace,
        playwrightArgs: [
          mutation.spec,
          ...(mutation.grep ? ["-g", mutation.grep] : []),
          ...playwrightArgs,
        ],
      });
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, "UI_PROPERTY_FAILURES_DIR");
      else process.env.UI_PROPERTY_FAILURES_DIR = previous;
    }
    const records = readFailures(failures);
    const result = {
      id: mutation.id,
      description: mutation.description,
      workspace: mutation.workspace,
      file: mutation.file,
      exitCode,
      verdict: verdict(mutation, exitCode, records),
      failures: records.map((record) => ({
        property: record.property,
        title: record.title,
        seed: record.seed,
        violation: record.violation,
        minimal: record.minimal,
        commands: record.commands,
      })),
    };
    const destination = join(evidenceRoot, mutation.id);
    mkdirSync(destination, { recursive: true });
    const runs = join(snapshot.root, "local_data/pstack/e2e");
    if (existsSync(runs)) cpSync(runs, join(destination, "e2e"), { recursive: true });
    if (existsSync(failures)) cpSync(failures, join(destination, "failures"), { recursive: true });
    writeFileSync(join(destination, "result.json"), JSON.stringify(result, null, 2));
    return result;
  } finally {
    snapshot.dispose();
  }
}

async function main(args) {
  let file;
  let only;
  const playwrightArgs = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--mutations") file = resolve(args[++index]);
    else if (args[index] === "--only") only = new Set(args[++index].split(","));
    else if (args[index] === "--") {
      playwrightArgs.push(...args.slice(index + 1));
      break;
    } else throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (!file)
    throw new Error(
      "Usage: node packages/ui-properties/scripts/mutation-proof.mjs --mutations <file.json> [--only id,id] [-- playwright args]",
    );
  const mutations = loadMutations(file).filter((mutation) => !only || only.has(mutation.id));
  const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const evidenceRoot = join(repository, "local_data/pstack/ui-properties/mutations", runId);
  mkdirSync(evidenceRoot, { recursive: true });
  const results = [];
  for (const mutation of mutations) {
    console.log(`\n=== mutation ${mutation.id}: ${mutation.description}`);
    const result = await proveMutation(mutation, { evidenceRoot, playwrightArgs });
    console.log(`mutation ${mutation.id}: ${result.verdict}`);
    for (const failure of result.failures)
      console.log(
        `  ${failure.title}: ${failure.violation.kind} "${failure.violation.name}" seed=${failure.seed} minimal=${failure.minimal.length} steps`,
      );
    results.push(result);
  }
  writeFileSync(join(evidenceRoot, "summary.json"), JSON.stringify(results, null, 2));
  console.log(`ui-property-mutations=${join(evidenceRoot, "summary.json")}`);
  return results.every((result) => result.verdict === "killed") ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
