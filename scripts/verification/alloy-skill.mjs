import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { ALLOY, ensureAlloy, javaVersion, runAlloy } from "./alloy.mjs";

const OPTIONS = ["--mutation-proof", "--allow-source-drift", "--record"];

export async function verifyAlloySkill({ skill, id, model, mutations, narrate }) {
  const root = resolve(skill, "../../..");
  const modelFile = join(skill, model);
  const coverageFile = join(skill, "coverage.json");
  const args = new Set(process.argv.slice(2));
  for (const arg of args) assert(OPTIONS.includes(arg), `Unknown option: ${arg}`);
  const record = args.has("--record");
  const mutationProof = record || args.has("--mutation-proof");

  const coverage = JSON.parse(await readFile(coverageFile, "utf8"));
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const read = (name) => readFile(join(root, name), "utf8");

  async function sourceFiles(directory) {
    const found = [];
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const name = `${directory}/${entry.name}`;
      if (entry.isDirectory()) found.push(...(await sourceFiles(name)));
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(name);
    }
    return found.sort();
  }

  async function census() {
    const result = Object.fromEntries(coverage.guardedWrites.map((needle) => [needle, {}]));
    for (const directory of coverage.censusRoots) {
      for (const name of await sourceFiles(directory)) {
        const text = await read(name);
        for (const needle of coverage.guardedWrites) {
          const count = text.split(needle).length - 1;
          if (count) result[needle][name] = count;
        }
      }
    }
    return result;
  }

  const hashes = Object.fromEntries(
    await Promise.all(
      Object.keys(coverage.sources).map(async (name) => [name, sha256(await read(name))]),
    ),
  );
  const callSites = await census();
  const packages = {};
  for (const [name, entry] of Object.entries(coverage.packages ?? {})) {
    const manifest = JSON.parse(await read(`${entry.from}/node_modules/${name}/package.json`));
    packages[name] = { ...entry, version: manifest.version };
  }
  const drift = [];
  for (const name of Object.keys(hashes)) {
    if (hashes[name] !== coverage.sources[name]) drift.push(`${name}: content changed`);
  }
  for (const needle of coverage.guardedWrites) {
    const before = coverage.callSites[needle] ?? {};
    const now = callSites[needle];
    for (const name of new Set([...Object.keys(before), ...Object.keys(now)])) {
      if (before[name] !== now[name]) {
        drift.push(
          `${name}: ${needle} appears ${now[name] ?? 0} times, recorded ${before[name] ?? 0}`,
        );
      }
    }
  }
  for (const [name, entry] of Object.entries(packages)) {
    const recorded = coverage.packages[name].version;
    if (entry.version !== recorded) {
      drift.push(`${name}: installed ${entry.version}, recorded ${recorded || "none"}`);
    }
  }
  const anchorFailures = [];
  for (const anchor of coverage.anchors) {
    const present = (await read(anchor.file)).includes(anchor.text);
    if (present === Boolean(anchor.absent)) {
      anchorFailures.push(
        `${anchor.file}: ${anchor.absent ? "now contains" : "no longer contains"} ${JSON.stringify(anchor.text)} (model: ${anchor.model})`,
      );
    }
  }

  const result = {
    verification: id,
    tool: `Alloy ${ALLOY.version}`,
    java: null,
    syncedCommit: coverage.syncedCommit,
    bounds: coverage.bounds,
    sourceDrift: drift,
    anchorFailures,
    checks: [],
    mutations: [],
    openFindings: [],
  };
  let exitCode = 0;
  const fail = (message) => {
    console.error(`FAIL  ${message}`);
    exitCode = 1;
  };
  const stale = drift.length > 0 || anchorFailures.length > 0;

  if (stale) {
    console.error("Covered code changed since the model was last confirmed:");
    for (const line of [...drift, ...anchorFailures]) console.error(`  ${line}`);
  }

  const scratch = await mkdtemp(join(tmpdir(), `${id}-`));
  try {
    if (stale && !record && !args.has("--allow-source-drift")) {
      console.error(
        "No result is accepted before review. Read SKILL.md, section 'When covered code changes'.",
      );
      exitCode = 2;
    } else {
      result.java = javaVersion();
      const jar = await ensureAlloy(root);
      const baseline = await runAlloy({ jar, model: modelFile, output: join(scratch, "baseline") });
      for (const expected of coverage.checks) {
        const actual = baseline[expected.name];
        if (!actual) {
          fail(`${expected.name}: the model has no such command`);
          continue;
        }
        const entry = { ...expected, satisfiable: actual.satisfiable, command: actual.source };
        result.checks.push(entry);
        if (expected.expect === "reachable") {
          if (actual.satisfiable) console.log(`ok    ${expected.name}: reachable`);
          else fail(`${expected.name}: no longer reachable, so other checks may pass vacuously`);
          continue;
        }
        if (!actual.satisfiable) {
          if (expected.expect === "holds") console.log(`ok    ${expected.name}: holds`);
          else {
            fail(
              `${expected.name}: recorded as open finding ${expected.finding}, but it now holds. Confirm the fix describes the code, then set "expect" to "holds".`,
            );
          }
          continue;
        }
        entry.counterexample = narrate(actual.states, expected.name);
        if (expected.expect === "finding") {
          result.openFindings.push(expected.finding);
          console.log(`open  ${expected.name}: finding ${expected.finding} still reproduces`);
        } else {
          fail(`${expected.name}: counterexample`);
        }
        console.log(`  Property: ${expected.property}`);
        console.log(`  Harm: ${expected.harm}`);
        console.log(entry.counterexample.join("\n"));
      }
      for (const name of Object.keys(baseline)) {
        if (!coverage.checks.some((check) => check.name === name)) {
          fail(`${name}: the model runs a command that coverage.json does not record`);
        }
      }

      if (mutationProof) {
        const source = await readFile(modelFile, "utf8");
        const outcomes = await Promise.all(
          mutations.map(async (mutation) => {
            assert.equal(
              source.split(mutation.find).length - 1,
              1,
              `Mutation ${mutation.id} no longer matches the model exactly once`,
            );
            const directory = join(scratch, mutation.id);
            await mkdir(directory);
            const mutant = join(directory, basename(modelFile));
            await writeFile(mutant, source.replace(mutation.find, mutation.replace));
            const run = await runAlloy({
              jar,
              model: mutant,
              output: join(directory, "out"),
              command: mutation.kills,
            });
            return { ...mutation, detected: run[mutation.kills]?.satisfiable === true };
          }),
        );
        for (const outcome of outcomes) {
          result.mutations.push({
            id: outcome.id,
            kills: outcome.kills,
            code: outcome.code,
            detected: outcome.detected,
          });
          if (outcome.detected) console.log(`ok    mutation ${outcome.id}: ${outcome.kills} fails`);
          else fail(`mutation ${outcome.id}: ${outcome.kills} still holds (${outcome.code})`);
        }
        assert.equal(
          await readFile(modelFile, "utf8"),
          source,
          "The model file changed during the run",
        );
      }

      if (record && exitCode === 0) {
        coverage.sources = hashes;
        coverage.callSites = callSites;
        for (const [name, entry] of Object.entries(packages)) {
          coverage.packages[name].version = entry.version;
        }
        coverage.syncedCommit = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: root,
          encoding: "utf8",
        }).trim();
        await writeFile(coverageFile, `${JSON.stringify(coverage, null, 2)}\n`);
        result.syncedCommit = coverage.syncedCommit;
        console.log(`recorded source hashes and call sites at ${coverage.syncedCommit}`);
      } else if (record) {
        console.error("Nothing recorded: the run above did not match coverage.json.");
      } else if (stale && exitCode === 0) {
        exitCode = 2;
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    exitCode = 1;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  const evidence = join(root, "local_data/pstack", id);
  await mkdir(evidence, { recursive: true });
  const evidenceFile = join(evidence, `${new Date().toISOString().replaceAll(":", "-")}.json`);
  result.exitCode = exitCode;
  await writeFile(evidenceFile, `${JSON.stringify(result, null, 2)}\n`);
  if (result.openFindings.length) {
    console.log(`Open findings in the product code: ${result.openFindings.join(", ")}`);
  }
  console.log(`${id}-result ${relative(root, evidenceFile)} exit=${exitCode}`);
  process.exitCode = exitCode;
}
