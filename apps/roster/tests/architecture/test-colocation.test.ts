import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROSTER_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ROOTS = ["app", "workers"];

const ALLOWLIST = new Set<string>();

const isTestFile = (name: string): boolean => /\.test\.tsx?$/.test(name);
const sourceBaseName = (name: string): string => name.replace(/\.tsx?$/, "");
const testPrefix = (name: string): string => name.replace(/\.test\.tsx?$/, "");

function subjectMatches(prefix: string, candidate: string): boolean {
  return prefix === candidate || prefix.startsWith(`${candidate}.`);
}

function resolveSubject(prefix: string, siblings: readonly string[]): string | undefined {
  return siblings
    .filter((name) => /\.tsx?$/.test(name) && !isTestFile(name))
    .map(sourceBaseName)
    .filter((candidate) => subjectMatches(prefix, candidate))
    .sort((a, b) => b.length - a.length)[0];
}

interface DirListing {
  readonly relDir: string;
  readonly files: readonly string[];
}

function listDirectories(root: string): DirListing[] {
  const listings: DirListing[] = [];
  const walk = (relDir: string): void => {
    const entries = readdirSync(join(ROSTER_ROOT, relDir), { withFileTypes: true });
    listings.push({
      relDir,
      files: entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
    });
    for (const entry of entries) {
      if (entry.isDirectory()) walk(`${relDir}/${entry.name}`);
    }
  };
  walk(root);
  return listings;
}

describe("test colocation", () => {
  it("every test names a sibling source it exercises", () => {
    const orphans: string[] = [];
    for (const root of ROOTS) {
      for (const { relDir, files } of listDirectories(root)) {
        for (const name of files) {
          if (!isTestFile(name)) continue;
          if (name.endsWith("architecture.test.ts")) continue;
          const relPath = `${relDir}/${name}`;
          if (ALLOWLIST.has(relPath)) continue;
          if (!resolveSubject(testPrefix(name), files)) {
            orphans.push(relPath);
          }
        }
      }
    }
    expect(
      orphans,
      "Rename each test to `<subject>.test.ts` (or `<subject>.<aspect>.test.ts`) next to the source it covers, or move a subsystem-wide test under tests/.",
    ).toEqual([]);
  });

  it("subjectMatches only accepts dot-bounded <subject> / <subject>.<aspect> names", () => {
    const cases: ReadonlyArray<{ prefix: string; candidate: string; match: boolean }> = [
      { prefix: "chunker.server", candidate: "chunker.server", match: true },
      { prefix: "acl-spans", candidate: "acl-spans", match: true },
      { prefix: "TipTapRenderer", candidate: "TipTapRenderer", match: true },
      { prefix: "sources.server.create", candidate: "sources.server", match: true },
      { prefix: "TipTapRenderer.toc", candidate: "TipTapRenderer", match: true },
      { prefix: "agent-notes.server.replace", candidate: "agent-notes.server", match: true },
      { prefix: "foo", candidate: "foo.server", match: false },
      { prefix: "sources", candidate: "sources.server", match: false },
      { prefix: "foo-extra", candidate: "foo", match: false },
      { prefix: "google-chat-scopes", candidate: "google-chat", match: false },
      { prefix: "chunkerServer", candidate: "chunker", match: false },
      { prefix: "sources-shared", candidate: "sources", match: false },
    ];
    for (const { prefix, candidate, match } of cases) {
      expect(subjectMatches(prefix, candidate), `${prefix} vs ${candidate}`).toBe(match);
    }
  });
});
