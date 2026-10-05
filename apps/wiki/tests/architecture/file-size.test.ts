import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Non-test source under `app/`, `workers/`, and `shared/` stays at or below
 * MAX_LINES. An agent that only needs a 40-line loader should not have to read a
 * 1,000-line file to find it. See `docs/wiki-refactoring/06-file-splits.md` for
 * the split principles ("separate things that are read for different reasons").
 *
 * `ALLOWLIST` freezes the two files Stage 06 deliberately did not split, at their
 * current size. It is **shrink-only**: a file may leave the list once it is at or
 * below MAX_LINES, but nothing new is added — an added entry is just "could not
 * split it" with extra steps. If a listed file grows past its frozen count the
 * test fails, so the exception cannot become a licence to keep bloating.
 */
const WIKI_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ROOTS = ["app", "workers", "shared"];
const MAX_LINES = 400;

const ALLOWLIST: Record<string, number> = {
  // `workers/features/ingestion/` is out of scope for Stage 06, and
  // `architecture.test.ts` pins 10+ layering constraints to this gateway — a
  // split would rewrite all of them.
  "workers/features/ingestion/model/ingestion-model-gateway.ts": 631,
  // Agents SDK class definition: the RPC surface is required to live on one
  // class, and splitting it would not separate anything read for a different
  // reason.
  "workers/agents/wiki-generation-agent.ts": 410,
};

const EXCLUDED_DIRS = new Set(["node_modules", "locales", "__snapshots__"]);
const isTestFile = (name: string): boolean => /\.test\.tsx?$/.test(name);
const isGenerated = (name: string): boolean =>
  name === "worker-configuration.d.ts" ||
  /\.gen\.tsx?$/.test(name) ||
  name.endsWith(".generated.ts");

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (relDir: string): void => {
    for (const entry of readdirSync(join(WIKI_ROOT, relDir), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          walk(`${relDir}/${entry.name}`);
        }
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || isTestFile(entry.name) || isGenerated(entry.name))
        continue;
      files.push(`${relDir}/${entry.name}`);
    }
  };
  walk(root);
  return files;
}

const lineCount = (relPath: string): number =>
  readFileSync(join(WIKI_ROOT, relPath), "utf8").split("\n").length;

describe("file size", () => {
  it("keeps non-test source at or below the line limit", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const relPath of sourceFiles(root)) {
        if (relPath in ALLOWLIST) continue;
        const lines = lineCount(relPath);
        if (lines > MAX_LINES) {
          offenders.push(`${relPath} (${lines} lines)`);
        }
      }
    }
    expect(
      offenders,
      `Split each file so no unit exceeds ${MAX_LINES} lines — see docs/wiki-refactoring/06-file-splits.md.`,
    ).toEqual([]);
  });

  it("holds allowlisted files at their frozen size and prompts removal once small enough", () => {
    const problems: string[] = [];
    for (const [relPath, frozen] of Object.entries(ALLOWLIST)) {
      const lines = lineCount(relPath);
      if (lines > frozen) {
        problems.push(`${relPath} grew to ${lines} lines (frozen at ${frozen}); shrink it back.`);
      }
      if (lines <= MAX_LINES) {
        problems.push(`${relPath} is now ${lines} lines — remove it from the file-size allowlist.`);
      }
    }
    expect(problems, "The file-size allowlist is shrink-only.").toEqual([]);
  });
});
