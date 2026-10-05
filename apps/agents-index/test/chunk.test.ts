import { describe, expect, it } from "vitest";

import { aclSourcesForChunk } from "../src/acl/frontmatter.ts";
import { pageMetadata } from "../src/acl/frontmatter.ts";
import { chunkMarkdown } from "../src/indexer/chunk.ts";

describe("chunkMarkdown", () => {
  it("excludes front matter while preserving original line ranges", () => {
    const markdown = "---\nvisibility: member\n---\n# Heading\n本文です\n";
    expect(chunkMarkdown(markdown)).toEqual([
      { startLine: 4, endLine: 5, text: "# Heading\n本文です" },
    ]);
  });

  it("attaches a span contained inside a chunk", () => {
    const markdown = '# Public\nnormal\n<acl src="secret">\n秘密\n</acl>\nmore\n';
    const [chunk] = chunkMarkdown(markdown);
    expect(aclSourcesForChunk(markdown, chunk)).toEqual(["secret"]);
  });

  it("reads YAML access grants from page front matter", () => {
    expect(
      pageMetadata(
        "---\nvisibility: restricted\naccess:\n  - subjectType: chapter\n    subjectKey: tokyo\n---\n# Tokyo\n",
      ),
    ).toEqual({
      visibility: "restricted",
      chapterId: null,
      access: [{ subjectType: "chapter", subjectKey: "tokyo" }],
    });
  });
});
