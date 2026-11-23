import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROSTER_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const TARGET_PATHS = ["app/features/public-roster", "app/routes/r.$token.tsx"];

const isTestFile = (name: string): boolean => /\.test\.tsx?$/.test(name);

function exists(relPath: string): boolean {
  try {
    statSync(join(ROSTER_ROOT, relPath));
    return true;
  } catch {
    return false;
  }
}

function sourceFiles(relPath: string): string[] {
  if (!exists(relPath)) return [];
  if (!statSync(join(ROSTER_ROOT, relPath)).isDirectory()) {
    return /\.tsx?$/.test(relPath) && !isTestFile(relPath) ? [relPath] : [];
  }
  const out: string[] = [];
  const walk = (relDir: string): void => {
    for (const entry of readdirSync(join(ROSTER_ROOT, relDir), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(`${relDir}/${entry.name}`);
      } else if (/\.tsx?$/.test(entry.name) && !isTestFile(entry.name)) {
        out.push(`${relDir}/${entry.name}`);
      }
    }
  };
  walk(relPath);
  return out;
}

const read = (relPath: string): string => readFileSync(join(ROSTER_ROOT, relPath), "utf8");

const BANNED_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: "Level", re: /\bLevel\b/ },
  { name: "LEVELS", re: /\bLEVELS\b/ },
  { name: "LEVEL_LABELS", re: /\bLEVEL_LABELS\b/ },
  { name: "LEVEL_DESCRIPTIONS", re: /\bLEVEL_DESCRIPTIONS\b/ },
  { name: "DEFAULT_LEVEL", re: /\bDEFAULT_LEVEL\b/ },
  { name: '"lead"', re: /["'`]lead["'`]/ },
  { name: '"exp"', re: /["'`]exp["'`]/ },
];

function scan(source: string): string[] {
  return BANNED_PATTERNS.filter(({ re }) => re.test(source)).map(({ name }) => name);
}

describe("public view exposure (ADR-005)", () => {
  it("the public view (feature dir + the r.$token.tsx route) never references an experience-level type, constant, or literal", () => {
    const offenders: string[] = [];
    for (const target of TARGET_PATHS) {
      for (const relPath of sourceFiles(target)) {
        for (const name of scan(read(relPath))) {
          offenders.push(`${relPath} references ${name}`);
        }
      }
    }
    expect(
      offenders,
      "ADR-005: the public view must never expose experience levels, even indirectly via a type/constant import — see docs/roster/adr.md ADR-005.",
    ).toEqual([]);
  });

  it("the scan actually fires on a deliberately reintroduced Level/LEVELS import (reviewer check)", () => {
    const fixture = [
      'import { LEVEL_LABELS, type Level, LEVELS, DEFAULT_LEVEL } from "~/features/applications/types";',
      'const x: Level = "lead";',
      'function isSenior(v: string) { return v === "exp"; }',
    ].join("\n");
    expect(scan(fixture).sort()).toEqual(
      ["Level", "LEVELS", "LEVEL_LABELS", "DEFAULT_LEVEL", '"lead"', '"exp"'].sort(),
    );
  });

  it("actually includes app/routes/r.$token.tsx in the scanned set, not just the feature directory", () => {
    const scanned = TARGET_PATHS.flatMap((target) => sourceFiles(target));
    expect(scanned).toContain("app/routes/r.$token.tsx");
  });

  it("does not false-positive on ordinary code that merely contains 'exp'/'export' as a substring", () => {
    const fixture = [
      "export function f() {}",
      'const expected = "value";',
      "// this comment mentions experience but not as a quoted literal",
      "const newValue = 1;",
    ].join("\n");
    expect(scan(fixture)).toEqual([]);
  });
});
