import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Ported from wiki/tests/architecture/layering.test.ts (see
 * docs/roster/adr.md ADR-003). Every allowlist below starts empty — roster
 * has no pre-existing cross-layer drift to carry over — and stays
 * shrink-only from here: an addition is "couldn't split it" with extra
 * steps, so it isn't allowed. See docs/roster/index.md §8.
 */
const ROSTER_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const isTestFile = (name: string): boolean => /\.test\.tsx?$/.test(name);

function dirExists(relDir: string): boolean {
  try {
    readdirSync(join(ROSTER_ROOT, relDir));
    return true;
  } catch {
    return false;
  }
}

function filesUnder(relRoot: string): string[] {
  if (!dirExists(relRoot)) return [];
  const out: string[] = [];
  const walk = (relDir: string): void => {
    for (const entry of readdirSync(join(ROSTER_ROOT, relDir), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
          walk(`${relDir}/${entry.name}`);
        }
      } else if (/\.tsx?$/.test(entry.name) && !isTestFile(entry.name)) {
        out.push(`${relDir}/${entry.name}`);
      }
    }
  };
  walk(relRoot);
  return out;
}

const read = (relPath: string): string => readFileSync(join(ROSTER_ROOT, relPath), "utf8");

/** All import specifiers (`import ... from "X"` and `import("X")`) in a file. */
function importSpecifiers(relPath: string): string[] {
  const source = read(relPath);
  const specs: string[] = [];
  for (const match of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    specs.push(match[1]);
  }
  return specs;
}

function directFileNames(relDir: string): string[] {
  if (!dirExists(relDir)) return [];
  return readdirSync(join(ROSTER_ROOT, relDir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !isTestFile(entry.name))
    .map((entry) => entry.name);
}

function directSubdirs(relDir: string): string[] {
  if (!dirExists(relDir)) return [];
  return readdirSync(join(ROSTER_ROOT, relDir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

// Both cross-layer import exemptions start empty. Shrink-only once something
// is ever added here (see the wiki original this was ported from for the
// pattern an entry should follow).
const LIB_FEATURE_IMPORT_ALLOWLIST = new Set<string>();
const WORKER_INTERNALS_IMPORT_ALLOWLIST = new Set<string>();

// `app/lib/` holds only the domain-free primitives that exist right now.
// Stage 02 adds `db.server.ts`; a later stage may add `utils.ts`. Whoever
// adds one updates this set in the same change — see
// docs/roster/01-workspace-scaffold.md "全ステージ共通の制約".
const LIB_ALLOWED_FILES = new Set(["return-to.ts"]);

// roster has no `app/components/` yet: no app shell, and per ADR-001 UI
// primitives come from `@gdgjp/gdg-lib`, not a local `ui/` directory. Both
// stay empty until a stage genuinely needs shared shell chrome.
const COMPONENTS_SHELL_FILES = new Set<string>();
const COMPONENTS_ALLOWED_SUBDIRS: string[] = [];

const WORKER_INTERNALS_RE = /workers\/features\/[a-z0-9-]+\/(persistence|orchestration)\//;

describe("layering", () => {
  it("app/lib/ does not import routes or app-shell components", () => {
    // lib is the bottom of the stack; a dependency on a route or a component
    // would make the primitive un-reusable and invite a cycle.
    const offenders: string[] = [];
    for (const relPath of filesUnder("app/lib")) {
      for (const spec of importSpecifiers(relPath)) {
        if (spec.startsWith("~/routes/") || spec.startsWith("~/components/")) {
          offenders.push(`${relPath} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("app/lib/ imports features only from the sanctioned dispatch/render files", () => {
    // Everything else in lib must be domain-free.
    const offenders: string[] = [];
    for (const relPath of filesUnder("app/lib")) {
      if (LIB_FEATURE_IMPORT_ALLOWLIST.has(relPath)) continue;
      for (const spec of importSpecifiers(relPath)) {
        if (spec.startsWith("~/features/")) offenders.push(`${relPath} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("app/lib/ top level is exactly the allowed primitive files", () => {
    // A whitelist, not a size cap: a new file in lib is almost always a
    // feature module that belongs under app/features/<domain>/. Exact match
    // in both directions so a renamed or deleted primitive fails here too,
    // not just an unexpected addition.
    const actual = directFileNames("app/lib").sort();
    const expected = [...LIB_ALLOWED_FILES].sort();
    expect(actual).toEqual(expected);
  });

  it("app/components/ top level is exactly the app-shell files, with only the allowed subdirs", () => {
    // Everything with a domain lives in app/features/<domain>/components/;
    // the shell would be the shared chrome every route renders. roster has
    // none of that yet.
    const actualFiles = directFileNames("app/components").sort();
    const expectedFiles = [...COMPONENTS_SHELL_FILES].sort();
    const subdirs = directSubdirs("app/components").sort();
    expect({ actualFiles, subdirs }).toEqual({
      actualFiles: expectedFiles,
      subdirs: [...COMPONENTS_ALLOWED_SUBDIRS].sort(),
    });
  });

  it("app/features/** does not import from app/routes/", () => {
    // Features are shared by many routes; importing one route couples the
    // domain to a URL and breaks reuse.
    const offenders: string[] = [];
    for (const relPath of filesUnder("app/features")) {
      for (const spec of importSpecifiers(relPath)) {
        if (spec.startsWith("~/routes/") || /(?:^|\/)routes\//.test(spec.replace(/^~\//, ""))) {
          if (spec.includes("routes/")) offenders.push(`${relPath} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("app/features/** and app/routes/** do not reach into worker persistence/orchestration internals", () => {
    // workers/features/<x>/persistence and /orchestration would be the
    // Worker-side implementation; the app tier should talk to features
    // through their public module surface, not storage or workflow guts.
    const offenders: string[] = [];
    for (const root of ["app/features", "app/routes"]) {
      for (const relPath of filesUnder(root)) {
        if (WORKER_INTERNALS_IMPORT_ALLOWLIST.has(relPath)) continue;
        for (const spec of importSpecifiers(relPath)) {
          if (WORKER_INTERNALS_RE.test(spec)) offenders.push(`${relPath} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("carries no stale layering exemptions", () => {
    // Both import allowlists are shrink-only. Every entry must still exist
    // and still contain the exact violation it is excused for; the moment
    // the drift is fixed, the entry has to be deleted or this fails.
    const stale: string[] = [];
    for (const relPath of LIB_FEATURE_IMPORT_ALLOWLIST) {
      const specs = importSpecifiers(relPath); // throws if the file is gone
      if (!specs.some((spec) => spec.startsWith("~/features/"))) {
        stale.push(
          `${relPath} no longer imports ~/features/ — remove it from LIB_FEATURE_IMPORT_ALLOWLIST`,
        );
      }
    }
    for (const relPath of WORKER_INTERNALS_IMPORT_ALLOWLIST) {
      const specs = importSpecifiers(relPath);
      if (!specs.some((spec) => WORKER_INTERNALS_RE.test(spec))) {
        stale.push(
          `${relPath} no longer reaches worker persistence/orchestration — remove it from WORKER_INTERNALS_IMPORT_ALLOWLIST`,
        );
      }
    }
    expect(stale).toEqual([]);
  });
});
