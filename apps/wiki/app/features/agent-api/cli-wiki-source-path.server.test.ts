import { describe, expect, it } from "vitest";
import {
  disambiguateRawManifestPaths,
  rawSourceDirectories,
  rawSourceDirectory,
  wikiHumanRawPath,
} from "./cli-wiki-source-path.server";
import type { WikiHumanPagePathEntry } from "./cli-wiki-source-path.server";

describe("rawSourceDirectory", () => {
  it("uses a bracketed title and sanitizes unsafe path segments", () => {
    expect(rawSourceDirectory(" Build with AI Kwansai 2026 ")).toBe("[Build with AI Kwansai 2026]");
    expect(rawSourceDirectory("Planning/Operations\\Runbook\0")).toBe(
      "[Planning／Operations＼Runbook]",
    );
    expect(rawSourceDirectory(" .. ")).toBe("[Untitled source]");
  });
});

describe("rawSourceDirectories", () => {
  it("uses source IDs only when titles collide", () => {
    expect(
      rawSourceDirectories([
        { id: "source-1", title: "Build with AI" },
        { id: "source-2", title: "Build with AI" },
        { id: "source-3", title: "Operations" },
      ]),
    ).toEqual(
      new Map([
        ["source-1", "[Build with AI] [source-1]"],
        ["source-2", "[Build with AI] [source-2]"],
        ["source-3", "[Operations]"],
      ]),
    );
  });
});

describe("wikiHumanRawPath", () => {
  const root = { id: "root", slug: "guides", parentId: null };
  const child = { id: "child", slug: "operations", parentId: "root" };
  const grandchild = { id: "grandchild", slug: "runbook", parentId: "child" };
  const pages = new Map<string, WikiHumanPagePathEntry>([
    [root.id, root],
    [child.id, child],
    [grandchild.id, grandchild],
  ]);

  it("mirrors root and nested pages using the page.md convention", () => {
    expect(wikiHumanRawPath(root, pages)).toBe("raw/guides/page.md");
    expect(wikiHumanRawPath(child, pages)).toBe("raw/guides/operations/page.md");
    expect(wikiHumanRawPath(grandchild, pages)).toBe("raw/guides/operations/runbook/page.md");
  });

  it("rejects a missing parent", () => {
    const orphan = { id: "orphan", slug: "orphan", parentId: "missing" };
    expect(() => wikiHumanRawPath(orphan, new Map([[orphan.id, orphan]]))).toThrow(
      "missing parent missing",
    );
  });

  it("rejects cyclic hierarchies", () => {
    const one = { id: "one", slug: "one", parentId: "two" };
    const two = { id: "two", slug: "two", parentId: "one" };
    const cycle = new Map<string, WikiHumanPagePathEntry>([
      [one.id, one],
      [two.id, two],
    ]);
    expect(() => wikiHumanRawPath(one, cycle)).toThrow("contains a cycle");
  });
});

describe("disambiguateRawManifestPaths", () => {
  it("keeps unique title paths unchanged and suffixes only collisions with stable IDs", () => {
    expect(
      disambiguateRawManifestPaths([
        { documentId: "doc-1", path: "raw/[Build with AI] 当日オペレーション.md" },
        { documentId: "doc-2", path: "raw/[Build with AI] 当日オペレーション.md" },
        { documentId: "doc-3", path: "raw/[Build with AI] assets/logo.png" },
      ]),
    ).toEqual([
      { documentId: "doc-1", path: "raw/[Build with AI] 当日オペレーション [doc-1].md" },
      { documentId: "doc-2", path: "raw/[Build with AI] 当日オペレーション [doc-2].md" },
      { documentId: "doc-3", path: "raw/[Build with AI] assets/logo.png" },
    ]);
  });
});
