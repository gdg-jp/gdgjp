import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Ported from wiki/tests/architecture/file-size.test.ts (see
 * docs/roster/adr.md ADR-003). Non-test source under `app/` and `workers/`
 * stays at or below MAX_LINES. `ALLOWLIST` is shrink-only and starts empty —
 * roster has no files over the limit yet.
 */
const ROSTER_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ROOTS = ["app", "workers"];
const MAX_LINES = 400;

const ALLOWLIST: Record<string, number> = {};

const EXCLUDED_DIRS = new Set(["node_modules", "__snapshots__"]);
const isTestFile = (name: string): boolean => /\.test\.tsx?$/.test(name);
const isGenerated = (name: string): boolean =>
  name === "worker-configuration.d.ts" ||
  /\.gen\.tsx?$/.test(name) ||
  name.endsWith(".generated.ts");

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (relDir: string): void => {
    for (const entry of readdirSync(join(ROSTER_ROOT, relDir), { withFileTypes: true })) {
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
  readFileSync(join(ROSTER_ROOT, relPath), "utf8").split("\n").length;

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
    expect(offenders, `Split each file so no unit exceeds ${MAX_LINES} lines.`).toEqual([]);
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
