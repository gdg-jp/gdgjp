import { describe, expect, it } from "vitest";
import { type SectionPatch, applyPatchesToMarkdown, tiptapToMarkdown } from "./tiptap-convert";
import type { TipTapDoc } from "./tiptap-convert";

describe("tiptapToMarkdown", () => {
  it("converts headings H1–H3", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Section" }] },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Sub" }] },
      ],
    };
    const md = tiptapToMarkdown(doc);
    expect(md).toContain("# Title");
    expect(md).toContain("## Section");
    expect(md).toContain("### Sub");
  });

  it("converts ordered lists", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Second" }] }],
            },
          ],
        },
      ],
    };
    const md = tiptapToMarkdown(doc);
    expect(md).toContain("1. First");
    expect(md).toContain("2. Second");
  });

  it("returns empty string for empty doc", () => {
    const doc: TipTapDoc = { type: "doc", content: [] };
    expect(tiptapToMarkdown(doc)).toBe("");
  });

  it("handles string input (JSON parse)", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
    };
    const result = tiptapToMarkdown(JSON.stringify(doc));
    expect(result).toContain("Hello");
  });
});

describe("applyPatchesToMarkdown", () => {
  const existingMarkdown = [
    "## 概要",
    "",
    "配信ガイドラインです。",
    "",
    "## 担当スタッフ",
    "",
    "- Yuki Hirai (GDG Tokyo)",
    "- Kosuke Itaya (GDG Osaka)",
  ].join("\n");

  it("appends content to a matching section", () => {
    const patches: SectionPatch[] = [
      {
        headingMatch: "担当スタッフ",
        operation: "append",
        content: "- たくてぃん (GDG Greater Kwansai)",
      },
    ];
    const result = applyPatchesToMarkdown(existingMarkdown, patches);
    expect(result).toContain("## 概要");
    expect(result).toContain("配信ガイドラインです。");
    expect(result).toContain("- Yuki Hirai (GDG Tokyo)");
    expect(result).toContain("- Kosuke Itaya (GDG Osaka)");
    expect(result).toContain("- たくてぃん (GDG Greater Kwansai)");
  });

  it("preserves all existing sections when patching", () => {
    const patches: SectionPatch[] = [
      {
        headingMatch: "担当スタッフ",
        operation: "append",
        content: "- New Person",
      },
    ];
    const result = applyPatchesToMarkdown(existingMarkdown, patches);
    const sections = result.split(/^## /m).filter(Boolean);
    expect(sections).toHaveLength(2);
  });

  it("prepends content to a matching section", () => {
    const patches: SectionPatch[] = [
      {
        headingMatch: "担当スタッフ",
        operation: "prepend",
        content: "- First Person",
      },
    ];
    const result = applyPatchesToMarkdown(existingMarkdown, patches);
    const staffIdx = result.indexOf("- First Person");
    const existingIdx = result.indexOf("- Yuki Hirai");
    expect(staffIdx).toBeLessThan(existingIdx);
  });

  it("appends unmatched heading as new section at the end", () => {
    const patches: SectionPatch[] = [
      {
        headingMatch: "関連リンク",
        operation: "append",
        content: "- https://example.com",
      },
    ];
    const result = applyPatchesToMarkdown(existingMarkdown, patches);
    expect(result).toContain("## 関連リンク");
    expect(result).toContain("- https://example.com");
    // New section should be at the end
    const staffIdx = result.indexOf("## 担当スタッフ");
    const linksIdx = result.indexOf("## 関連リンク");
    expect(linksIdx).toBeGreaterThan(staffIdx);
  });

  it("handles null headingMatch (append to end of document)", () => {
    const patches: SectionPatch[] = [
      {
        headingMatch: null,
        operation: "append",
        newHeading: "備考",
        content: "新しい備考",
      },
    ];
    const result = applyPatchesToMarkdown(existingMarkdown, patches);
    expect(result).toContain("## 備考");
    expect(result).toContain("新しい備考");
  });

  it("does not treat headings inside fenced code blocks as sections", () => {
    const mdWithCodeFence = [
      "## 概要",
      "",
      "配信ガイドラインです。",
      "",
      "```markdown",
      "## 担当スタッフ",
      "これはコードブロック内のヘッダーです",
      "```",
      "",
      "## 担当スタッフ",
      "",
      "- Yuki Hirai (GDG Tokyo)",
    ].join("\n");

    const patches: SectionPatch[] = [
      {
        headingMatch: "担当スタッフ",
        operation: "append",
        content: "- New Person",
      },
    ];
    const result = applyPatchesToMarkdown(mdWithCodeFence, patches);
    // Code fence content should be preserved unchanged
    expect(result).toContain(
      "```markdown\n## 担当スタッフ\nこれはコードブロック内のヘッダーです\n```",
    );
    // Patch should be applied to the real section, not inside the code fence
    expect(result).toContain("- New Person");
    // The real 担当スタッフ section (last occurrence) has the patch appended
    const realSectionIdx = result.lastIndexOf("## 担当スタッフ");
    const newPersonIdx = result.indexOf("- New Person");
    expect(newPersonIdx).toBeGreaterThan(realSectionIdx);
  });

  it("renders patches as sections when no existing content", () => {
    const patches: SectionPatch[] = [
      {
        headingMatch: "担当スタッフ",
        operation: "append",
        content: "- たくてぃん",
      },
    ];
    const result = applyPatchesToMarkdown("", patches);
    expect(result).toBe("## 担当スタッフ\n\n- たくてぃん");
  });
});
