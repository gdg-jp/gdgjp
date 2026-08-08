#!/usr/bin/env node
// 計画ファイルが /cursor:from-plan で正しく抽出されるかを確認する。
//
//   node .claude/skills/plan-creator/scripts/check-extraction.mjs docs/plans/*.md
//
// 導入済みの cursor プラグインの plan.mjs があればそれを import して、
// 実際の変換器と同じ判定を行う。見つからなければ同等のロジックで代替する
// （プラグイン側が更新されると乖離しうるので、その旨を警告する）。

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CANDIDATE_ROOTS = [
  join(homedir(), ".claude/plugins/cache/tomas-cursor/cursor"),
  join(homedir(), ".claude/plugins/marketplaces/tomas-cursor/plugins/cursor"),
];

/** 導入済みプラグインの scripts/lib/plan.mjs を探す。 */
function findPluginPlanLib() {
  for (const root of CANDIDATE_ROOTS) {
    if (!existsSync(root)) continue;
    const direct = join(root, "scripts/lib/plan.mjs");
    if (existsSync(direct)) return direct;
    for (const entry of readdirSync(root)) {
      const nested = join(root, entry, "scripts/lib/plan.mjs");
      if (existsSync(nested)) return nested;
    }
  }
  return null;
}

// プラグインが見つからないときの代替。plan.mjs の SECTION_HINTS と同じ内容。
const FALLBACK_HINTS = {
  context: ["context", "background", "why", "motivation"],
  approach: ["approach", "plan", "implementation", "solution", "design"],
  files: [
    "file-by-file change list",
    "files to touch",
    "files to modify",
    "critical files",
    "critical files to touch",
    "critical files to modify",
    "files",
  ],
  verification: ["verification", "how to verify", "test plan", "tests", "acceptance criteria"],
};

function fallbackSections(raw) {
  const sections = {};
  let key = null;
  let buffer = [];
  let inFence = false;
  const flush = () => {
    if (key) sections[key] = buffer.join("\n").trim();
    buffer = [];
  };
  for (const line of raw.split("\n")) {
    // コードブロック内の `## ` を見出しと誤認しない。
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && line.startsWith("## ")) {
      flush();
      key = line.slice(3).trim().toLowerCase();
      continue;
    }
    if (key) buffer.push(line);
  }
  flush();
  return sections;
}

function fallbackPick(sections, intent) {
  for (const hint of FALLBACK_HINTS[intent]) {
    for (const key of Object.keys(sections)) {
      if (key === hint || key.startsWith(`${hint}:`) || key.startsWith(`${hint} `)) {
        return sections[key];
      }
    }
  }
  return "";
}

const INTENTS = ["context", "approach", "files", "verification"];
const LABEL = {
  context: "Context",
  approach: "Design/Approach",
  files: "Files",
  verification: "Verification",
};

async function loadChecker() {
  const libPath = findPluginPlanLib();
  if (libPath) {
    const lib = await import(pathToFileURL(libPath).href);
    return {
      source: libPath,
      check: (file) => {
        const plan = lib.parsePlanFile(file);
        const found = {};
        for (const intent of INTENTS) found[intent] = lib.pickSection(plan.sections, intent);
        return { title: plan.title, slug: plan.slug, found };
      },
    };
  }
  return {
    source: null,
    check: (file) => {
      const raw = readFileSync(file, "utf8");
      const sections = fallbackSections(raw);
      const titleLine = raw.split("\n").find((l) => l.startsWith("# "));
      const found = {};
      for (const intent of INTENTS) found[intent] = fallbackPick(sections, intent);
      return { title: titleLine ? titleLine.slice(2).trim() : "", slug: "", found };
    },
  };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  process.stderr.write(
    "usage: check-extraction.mjs <plan.md> [...]\n" +
      "例: node .claude/skills/plan-creator/scripts/check-extraction.mjs docs/plans/*.md\n",
  );
  process.exit(2);
}

const checker = await loadChecker();
if (!checker.source) {
  process.stderr.write(
    "警告: cursor プラグインの plan.mjs が見つからないため内蔵ロジックで判定します。\n" +
      "      プラグインが更新されていると結果が乖離する可能性があります。\n\n",
  );
}

const width = Math.max(...files.map((f) => f.length));
let failed = 0;

for (const file of files) {
  if (!existsSync(file)) {
    console.log(`${file.padEnd(width)}  NOT FOUND`);
    failed += 1;
    continue;
  }
  const { title, found } = checker.check(file);
  const missing = INTENTS.filter((i) => !found[i]).map((i) => LABEL[i]);
  if (missing.length === 0) {
    const size = INTENTS.reduce((n, i) => n + found[i].length, 0);
    console.log(`${file.padEnd(width)}  OK        (${size} chars)  ${title}`);
  } else {
    console.log(`${file.padEnd(width)}  MISSING:  ${missing.join(", ")}`);
    failed += 1;
  }
}

if (failed > 0) {
  console.log(
    "\n抽出されない節がある計画は、タイトルだけの task ファイルになります。" +
      "\n見出しを `## Context — ...` `## Design — ...` `## Files to touch — ...` `## Verification — ...` に直してください。" +
      "\n（overview や付録など delegate しないファイルは MISSING で正常です）",
  );
}
process.exit(failed > 0 ? 1 : 0);
