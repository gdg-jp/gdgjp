#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const roles = [
  "feature, refactoring",
  "bug-fix",
  "perf-issue",
  "hillclimb",
  "judgment and prose",
  "arena runners",
  "arena cross-judge pool",
  "swarm workers",
  "interrogate reviewers",
];

export function ensureLink(base, name, target) {
  const path = resolve(base, name);
  const expected = resolve(dirname(path), target);
  let current;
  try {
    current = lstatSync(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (current) {
    if (existsSync(path) && realpathSync(path) === realpathSync(expected)) return;
    throw new Error(`Preserving existing ${name}: expected a link to ${target}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path);
}

function links(base, skills) {
  const result = [
    [".cursor/skills", "../.agents/skills"],
    [".cursor/rules/pstack-models.mdc", "../../.agents/pstack/models.mdc"],
    [".codex/pstack-models.md", "../.agents/pstack/models.mdc"],
    [".claude/rules/pstack-models.md", "../../.agents/pstack/models.mdc"],
    [".claude/docs", "../.agents/docs"],
    [".cursor/docs", "../.agents/docs"],
    [".claude/README.md", "../.agents/README.md"],
    [".cursor/README.md", "../.agents/README.md"],
  ];
  for (const skill of skills) {
    result.push([`.claude/skills/${skill}`, `../../.agents/skills/${skill}`]);
  }
  for (const harness of [".cursor", ".claude"]) {
    for (const agent of ["poteto-agent", "comment-sicko"]) {
      result.push([`${harness}/agents/${agent}.md`, `../../.agents/agents/${agent}.md`]);
    }
  }
  return result.map(([name, target]) => ({ name, target, path: resolve(base, name) }));
}

export function setupInstallation(base) {
  const manifest = JSON.parse(readFileSync(resolve(base, ".agents/pstack/manifest.json"), "utf8"));
  for (const { name, target } of links(base, manifest.skills)) ensureLink(base, name, target);
}

export function checkInstallation(base) {
  const manifest = JSON.parse(readFileSync(resolve(base, ".agents/pstack/manifest.json"), "utf8"));
  const errors = [];
  for (const { name, target, path } of links(base, manifest.skills)) {
    const expected = resolve(dirname(path), target);
    if (!existsSync(path) || realpathSync(path) !== realpathSync(expected)) {
      errors.push(`${name}: missing or points to a different source`);
    }
  }
  for (const name of manifest.skills) {
    const path = resolve(base, ".agents/skills", name, "SKILL.md");
    if (!existsSync(path)) {
      errors.push(`Missing skill: ${name}`);
      continue;
    }
    const content = readFileSync(path, "utf8");
    try {
      const header = parse(content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "");
      if (header?.name !== name || !header?.description)
        errors.push(`${name}: invalid frontmatter`);
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
    }
    for (const harness of [".agents", ".claude", ".cursor"]) {
      const entrypoint = resolve(base, harness, "skills", name, "SKILL.md");
      for (const [, href] of content.matchAll(/\]\(([^)]+)\)/g)) {
        const target = href.split("#")[0];
        if (!target || /^(?:https?:|mailto:|\/|<)/.test(target)) continue;
        if (!existsSync(resolve(dirname(entrypoint), target))) {
          errors.push(`${harness}/${name}: unresolved reference ${target}`);
        }
      }
    }
  }
  const models = readFileSync(resolve(base, ".agents/pstack/models.mdc"), "utf8");
  if (!models.includes("# defaults: 3")) errors.push("Missing model defaults version");
  if (!/^# budget: (large \(xhigh\)|medium \(high\)|small \(medium\))$/m.test(models)) {
    errors.push("Invalid reasoning budget");
  }
  const entries = models
    .split("\n")
    .filter((line) => roles.some((role) => line.startsWith(`${role}: `)));
  for (const role of roles) {
    if (entries.filter((line) => line.startsWith(`${role}: `)).length !== 1) {
      errors.push(`Expected one model entry for ${role}`);
    }
  }
  const availability = JSON.parse(
    readFileSync(resolve(base, ".agents/pstack/availability.json"), "utf8"),
  );
  const confirmed = new Set([...availability.models, "auto", "inherit-parent"]);
  for (const entry of entries) {
    for (const model of entry.split(": ")[1].split(", ")) {
      if (!confirmed.has(model))
        errors.push(`Unconfirmed model ${model}; confirm availability and update doctor`);
    }
  }
  return { errors, skills: manifest.skills };
}

function main() {
  const command = process.argv[2] ?? "doctor";
  if (!["setup", "doctor", "list"].includes(command)) throw new Error("Use setup, doctor, or list");
  const manifest = JSON.parse(readFileSync(resolve(root, ".agents/pstack/manifest.json"), "utf8"));
  if (command === "list") {
    for (const name of manifest.skills) console.log(name);
    return;
  }
  if (command === "setup") {
    setupInstallation(root);
  }
  const { errors, skills } = checkInstallation(root);
  for (const error of errors) console.error(`FAIL ${error}`);
  if (errors.length) {
    process.exitCode = 1;
    return;
  }
  console.log(
    `PASS ${skills.length} pstack/project skills, references, discovery links, and 9 model roles`,
  );
  for (const bin of ["node", "pnpm", "codex", "claude", "agent"]) {
    const result = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 10_000 });
    console.log(`${result.status === 0 ? "FOUND" : "OPTIONAL/MISSING"} ${bin}`);
  }
  console.log(
    "Model identifiers are checked against the dated setup record, not live entitlements.",
  );
  console.log("Tool presence and configuration do not verify login or model execution.");
  console.log(
    `Configuration: ${relative(root, realpathSync(resolve(root, ".codex/pstack-models.md")))}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
