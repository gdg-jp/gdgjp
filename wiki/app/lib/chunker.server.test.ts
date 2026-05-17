import { describe, expect, it } from "vitest";
import { chunkPageContent } from "./chunker.server";

const TIPTAP_DOC_JA = JSON.stringify({
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "概要" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "これはテストページの概要です。GDGの活動について説明します。" },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "詳細" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "詳細なコンテンツがここに入ります。" }],
    },
  ],
});

const TIPTAP_DOC_EN = JSON.stringify({
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Overview" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "This is the overview of the test page about GDG activities." },
      ],
    },
  ],
});

describe("chunkPageContent", () => {
  it("produces chunks for both JA and EN content", () => {
    const chunks = chunkPageContent({
      pageId: "page-1",
      slug: "test-page",
      titleJa: "テストページ",
      titleEn: "Test Page",
      summaryJa: "テストの要約",
      summaryEn: "Test summary",
      contentJa: TIPTAP_DOC_JA,
      contentEn: TIPTAP_DOC_EN,
    });

    const jaChunks = chunks.filter((c) => c.language === "ja");
    const enChunks = chunks.filter((c) => c.language === "en");

    expect(jaChunks.length).toBeGreaterThan(0);
    expect(enChunks.length).toBeGreaterThan(0);

    for (const chunk of chunks) {
      expect(chunk.pageId).toBe("page-1");
      expect(chunk.slug).toBe("test-page");
    }
  });

  it("skips empty content", () => {
    const chunks = chunkPageContent({
      pageId: "page-2",
      slug: "empty",
      titleJa: "空ページ",
      titleEn: "",
      summaryJa: "",
      summaryEn: "",
      contentJa: "",
      contentEn: "",
    });

    expect(chunks).toHaveLength(0);
  });

  it("preserves section headings in chunk metadata", () => {
    const chunks = chunkPageContent({
      pageId: "page-3",
      slug: "with-headings",
      titleJa: "見出し付きページ",
      titleEn: "Page with headings",
      summaryJa: "テスト要約",
      summaryEn: "Test summary",
      contentJa: TIPTAP_DOC_JA,
      contentEn: "",
    });

    const headings = chunks.map((c) => c.sectionHeading).filter(Boolean);
    expect(headings.length).toBeGreaterThan(0);
  });

  it("assigns sequential chunkIndex per language", () => {
    const chunks = chunkPageContent({
      pageId: "page-4",
      slug: "sequential",
      titleJa: "テスト",
      titleEn: "Test",
      summaryJa: "要約",
      summaryEn: "Summary",
      contentJa: TIPTAP_DOC_JA,
      contentEn: TIPTAP_DOC_EN,
    });

    const jaChunks = chunks.filter((c) => c.language === "ja");
    const enChunks = chunks.filter((c) => c.language === "en");

    jaChunks.forEach((c, i) => expect(c.chunkIndex).toBe(i));
    enChunks.forEach((c, i) => expect(c.chunkIndex).toBe(i));
  });

  it("handles plain string content (non-JSON)", () => {
    const chunks = chunkPageContent({
      pageId: "page-5",
      slug: "plain",
      titleJa: "プレーンテスト",
      titleEn: "Plain Test",
      summaryJa: "要約",
      summaryEn: "Summary",
      contentJa: "これは通常のテキストです。JSONではないコンテンツをテストしています。",
      contentEn: "",
    });

    // tiptapToMarkdown falls back to returning the string as-is for non-JSON
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toContain(
      "これは通常のテキストです。JSONではないコンテンツをテストしています。",
    );
  });
});
