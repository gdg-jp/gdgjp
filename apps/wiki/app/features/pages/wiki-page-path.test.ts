import { describe, expect, it } from "vitest";
import { classifyWikiRequestPath, wikiPagePath } from "./wiki-page-path";

describe("wikiPagePath", () => {
  it("joins segments under /s/<space>/wiki", () => {
    expect(wikiPagePath(["about"])).toBe("/s/gdg-jp/wiki/about");
    expect(wikiPagePath(["about", "results"])).toBe("/s/gdg-jp/wiki/about/results");
  });

  it("percent-encodes each segment", () => {
    expect(wikiPagePath(["hello world", "a/b"])).toBe("/s/gdg-jp/wiki/hello%20world/a%2Fb");
  });
});

describe("classifyWikiRequestPath", () => {
  it("matches when requested equals canonical (including single-segment roots)", () => {
    expect(classifyWikiRequestPath(["about"], ["about"])).toBe("match");
    expect(classifyWikiRequestPath(["parent", "child"], ["parent", "child"])).toBe("match");
  });

  it("redirects a bare flat slug when the canonical path is nested", () => {
    expect(classifyWikiRequestPath(["child"], ["parent", "child"])).toBe("redirect");
  });

  it("does not redirect when a single-segment request is already canonical", () => {
    expect(classifyWikiRequestPath(["root"], ["root"])).toBe("match");
  });

  it("returns not-found for wrong, partial, or reordered multi-segment paths", () => {
    expect(classifyWikiRequestPath(["wrong", "child"], ["parent", "child"])).toBe("not-found");
    expect(classifyWikiRequestPath(["parent"], ["grandparent", "parent", "child"])).toBe(
      "redirect",
    );
    expect(classifyWikiRequestPath(["child", "parent"], ["parent", "child"])).toBe("not-found");
    expect(classifyWikiRequestPath(["parent", "child", "extra"], ["parent", "child"])).toBe(
      "not-found",
    );
    expect(classifyWikiRequestPath(["parent", "other"], ["parent", "child", "other"])).toBe(
      "not-found",
    );
  });
});
