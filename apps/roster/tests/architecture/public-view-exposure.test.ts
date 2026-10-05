import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The 10th architecture test (docs/roster/09-share-public-views.md "Design"
 * §4, docs/roster/adr.md ADR-005): the public view must never expose
 * experience levels, even indirectly through an import that never renders
 * visibly. ADR-005's own Context is explicit about why a UI-only guard isn't
 * enough — "it'll get re-added because it's convenient" is the exact failure
 * mode this pins down mechanically instead of aspirationally, the same
 * rationale ADR-003 gives for every other test in this directory.
 *
 * Scans `app/features/public-roster/` (non-test source) AND
 * `app/routes/r.$token.tsx` for the identifiers/literals that would carry
 * the experience-level concept in: the `Level` type, the `LEVELS` tuple
 * (plus its sibling constants — `LEVEL_LABELS`/`LEVEL_DESCRIPTIONS`/
 * `DEFAULT_LEVEL`, cheap to add once the mechanism exists), and the bare
 * string literals `"lead"`/`"exp"`. Deliberately does NOT ban the substring
 * "new" (also a `Level` value) — every file in this codebase writes
 * `new Map()`/`new Date()`, so that would be nothing but false positives;
 * docs/roster/09-share-public-views.md's own "Design" §4 omits it from the
 * list for the same reason.
 *
 * `r.$token.tsx` is scanned explicitly, not just the feature directory: it's
 * the actual rendered public route (not merely a consumer of
 * `public-roster/`'s exports) and it already imports from
 * `~/features/solver/types`, where `Level` is independently declared
 * (ADR-004 keeps the solver's own `Level` separate from `applications/
 * types.ts`'s) — a future "let's just show it in the role view too" edit
 * landing directly in the route file would be invisible to this test if it
 * only scanned the feature directory. This gap was caught in review; keep
 * both targets when either file moves or splits.
 *
 * NOTE: this is a raw-text scan, not comment-aware — a doc comment inside
 * either target that merely *mentions* "Level" or a quoted "lead"/"exp"
 * will also trip this test. That's an accepted false-positive risk (write
 * around it, e.g. "経験レベル" in Japanese, rather than loosening the regex)
 * given the alternative is a real detection gap.
 *
 * Uses the readFileSync + regex pattern already established by
 * `layering.test.ts`/`file-size.test.ts`/`test-colocation.test.ts` in this
 * same directory (ported from `wiki/tests/architecture/`, ADR-003) rather
 * than a real import-graph analyzer — the stage doc explicitly allows this
 * ("1 は import 解析...難しいので...でも良い").
 *
 * The loader's actual RETURNED DATA (email/contact/note/skills/availability/
 * locked, and sheet-visibility gating assembly rather than just rendering) is a
 * structural property a source scan can't verify — that's covered instead by
 * `app/features/public-roster/public-roster.server.test.ts`, which calls the
 * assembly function directly and inspects its real keys.
 */
const ROSTER_ROOT = fileURLToPath(new URL("../../", import.meta.url));

// A directory (walked recursively for non-test .ts/.tsx) or a single file —
// see the module doc comment for why the route file is listed explicitly
// alongside the feature directory rather than relying on the directory scan
// alone.
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
  if (!exists(relPath)) return []; // shouldn't happen once Stage 09 lands
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

// Word-bounded (`\b`) so these never match inside an unrelated identifier
// (e.g. a hypothetical `SkillLevel` or `LEVEL_LABELS` — case-sensitive, so
// "LEVEL_LABELS" doesn't trip the "LEVELS" check either). Quote-bounded
// (single, double, AND backtick) for the string literals so `"lead"`/`"exp"`
// never matches an unrelated word that merely contains those letters as a
// substring (`export`, `experience`, `expected`, ...) — only an actual
// quoted/templated value literal.
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
    // Proves the mechanism catches the exact failure ADR-005 is worried
    // about: someone later importing LEVELS/Level "because it's convenient"
    // into a public-roster file. Exercises real import + usage syntax, not
    // just a bare word in isolation.
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
    // Regression guard for the review finding this test originally missed:
    // the scan must cover the rendered route file itself, since it already
    // imports from ~/features/solver/types (where `Level` also lives) and a
    // future reintroduction could land there directly rather than under
    // app/features/public-roster/.
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
