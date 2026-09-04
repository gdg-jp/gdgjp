import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Makes the Stage 05 placement rules executable. Each assertion carries a
 * one-line reason: a prohibition nobody remembers the point of gets routed
 * around the first time it is inconvenient.
 * See `docs/wiki-refactoring/index.md` §2 and `workers/features/ingestion/README.md`.
 */
const WIKI_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const isTestFile = (name: string): boolean => /\.test\.tsx?$/.test(name);

function filesUnder(relRoot: string): string[] {
  const out: string[] = [];
  const walk = (relDir: string): void => {
    for (const entry of readdirSync(join(WIKI_ROOT, relDir), { withFileTypes: true })) {
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

const read = (relPath: string): string => readFileSync(join(WIKI_ROOT, relPath), "utf8");

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
  return readdirSync(join(WIKI_ROOT, relDir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !isTestFile(entry.name))
    .map((entry) => entry.name);
}

function directSubdirs(relDir: string): string[] {
  return readdirSync(join(WIKI_ROOT, relDir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

// `app/lib/` holds cross-cutting primitives, but two of them are the queue
// dispatcher and the OG renderer — both fan OUT to feature code by design, and
// Stage 06's rule-2 list keeps both files in `app/lib/`. These exemptions
// predate Stage 06; relocating a sanctioned primitive is out of scope for a
// cut-and-wire stage. The "no stale exemptions" test below makes the list
// shrink-only: an entry that no longer violates must be deleted.
const LIB_FEATURE_IMPORT_ALLOWLIST = new Set([
  "app/lib/queue-processors.server.ts",
  "app/lib/og-image.server.tsx",
]);

// The bounded, permission-aware Wiki workspace read store is consumed by the
// agent read-API. Until it re-exports through a public entry point, these two
// files are the known exception to the worker-internals import ban. Pre-existing
// drift, not introduced by Stage 06 (which may not touch
// `workers/features/ingestion/`). Also shrink-only — see below.
const WORKER_INTERNALS_IMPORT_ALLOWLIST = new Set([
  "app/features/agent-api/workspace.server.ts",
  "app/features/agent-api/notes.server.ts",
]);

const LIB_ALLOWED_FILES = new Set([
  "db.server.ts",
  "utils.ts",
  "time.ts",
  "color-utils.ts",
  "url-extract.ts",
  "queue-processors.server.ts",
  "chapter-directory.server.ts",
  "og-image.server.tsx",
]);

const COMPONENTS_SHELL_FILES = new Set([
  "Navbar.tsx",
  "Footer.tsx",
  "Sidebar.tsx",
  "AdminNavSection.tsx",
  "NavItem.tsx",
  "NavigationProgress.tsx",
  "BaseSidebar.tsx",
  "SidebarDialog.tsx",
  "SidebarPopover.tsx",
  "Toast.tsx",
  "Tooltip.tsx",
  "ConfirmDialog.tsx",
  "Skeleton.tsx",
]);

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

  it("app/lib/ imports features only from the two sanctioned dispatch/render files", () => {
    // Everything else in lib must be domain-free; the queue dispatcher and OG
    // renderer are the deliberate fan-out points.
    const offenders: string[] = [];
    for (const relPath of filesUnder("app/lib")) {
      if (LIB_FEATURE_IMPORT_ALLOWLIST.has(relPath)) continue;
      for (const spec of importSpecifiers(relPath)) {
        if (spec.startsWith("~/features/")) offenders.push(`${relPath} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("app/lib/ top level is exactly the eight allowed primitive files", () => {
    // A whitelist, not a size cap: a new file in lib is almost always a feature
    // module that belongs under app/features/<domain>/. Exact match in both
    // directions so a renamed or deleted primitive fails here too, not just an
    // unexpected addition.
    const actual = directFileNames("app/lib").sort();
    const expected = [...LIB_ALLOWED_FILES].sort();
    expect(actual).toEqual(expected);
  });

  it("app/components/ top level is exactly the app-shell files, with ui/ as the only subdir", () => {
    // Everything with a domain lives in app/features/<domain>/components/; the
    // shell is the shared chrome that every route renders. Exact match in both
    // directions — a missing shell file is as much a drift as an extra one.
    const actualFiles = directFileNames("app/components").sort();
    const expectedFiles = [...COMPONENTS_SHELL_FILES].sort();
    const subdirs = directSubdirs("app/components").sort();
    expect({ actualFiles, subdirs }).toEqual({ actualFiles: expectedFiles, subdirs: ["ui"] });
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
    // workers/features/<x>/persistence and /orchestration are the Worker-side
    // implementation; the app tier talks to features through their public
    // module surface, not their storage or workflow guts (see the ingestion
    // README convention).
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
    // Both import allowlists are shrink-only. Every entry must still exist and
    // still contain the exact violation it is excused for; the moment the drift
    // is fixed, the entry has to be deleted or this fails. That is what keeps an
    // exemption from silently outliving its reason.
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
