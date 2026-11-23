import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

const LIB_FEATURE_IMPORT_ALLOWLIST = new Set<string>();
const WORKER_INTERNALS_IMPORT_ALLOWLIST = new Set<string>();

const LIB_ALLOWED_FILES = new Set(["return-to.ts", "db.server.ts"]);

const COMPONENTS_SHELL_FILES = new Set(["AppShell.tsx", "PublicShell.tsx", "RosterBrand.tsx"]);
const COMPONENTS_ALLOWED_SUBDIRS: string[] = [];

const WORKER_INTERNALS_RE = /workers\/features\/[a-z0-9-]+\/(persistence|orchestration)\//;

describe("layering", () => {
  it("app/lib/ does not import routes or app-shell components", () => {
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
    const actual = directFileNames("app/lib").sort();
    const expected = [...LIB_ALLOWED_FILES].sort();
    expect(actual).toEqual(expected);
  });

  it("app/components/ top level is exactly the app-shell files, with only the allowed subdirs", () => {
    const actualFiles = directFileNames("app/components").sort();
    const expectedFiles = [...COMPONENTS_SHELL_FILES].sort();
    const subdirs = directSubdirs("app/components").sort();
    expect({ actualFiles, subdirs }).toEqual({
      actualFiles: expectedFiles,
      subdirs: [...COMPONENTS_ALLOWED_SUBDIRS].sort(),
    });
  });

  it("app/features/** does not import from app/routes/", () => {
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
    const stale: string[] = [];
    for (const relPath of LIB_FEATURE_IMPORT_ALLOWLIST) {
      const specs = importSpecifiers(relPath);
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
