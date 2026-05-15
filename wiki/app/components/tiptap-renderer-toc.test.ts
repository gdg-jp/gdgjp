import { describe, expect, it } from "vitest";
import { extractTocItems } from "~/components/TipTapRenderer";
import type { TipTapDoc } from "~/components/TipTapRenderer";

describe("extractTocItems", () => {
  it("returns empty array for empty doc", () => {
    const doc: TipTapDoc = { type: "doc", content: [] };
    expect(extractTocItems(doc)).toEqual([]);
  });

  it("extracts only h2 and h3 headings", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Section" }] },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Subsection" }] },
        { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "Deep" }] },
      ],
    };
    const items = extractTocItems(doc);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ text: "Section", level: 2 });
    expect(items[1]).toMatchObject({ text: "Subsection", level: 3 });
  });

  it("generates slugified IDs from heading text", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Hello World" }],
        },
      ],
    };
    const items = extractTocItems(doc);
    expect(items[0].id).toBe("h-hello-world");
    expect(items[0].text).toBe("Hello World");
  });

  it("deduplicates identical heading IDs sequentially", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Foo" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Foo" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Foo" }] },
      ],
    };
    const items = extractTocItems(doc);
    expect(items[0].id).toBe("h-foo");
    expect(items[1].id).toBe("h-foo-1");
    expect(items[2].id).toBe("h-foo-2");
  });

  it("counts h1 headings in the counter even though they are not included in output", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Section" }] },
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Section" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Section" }] },
      ],
    };
    const items = extractTocItems(doc);
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("h-section");
    // h1 consumed count=1, so second h2 gets count=2
    expect(items[1].id).toBe("h-section-2");
  });

  it("strips special characters from IDs", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Hello, World! (2024)" }],
        },
      ],
    };
    const items = extractTocItems(doc);
    expect(items[0].id).toBe("h-hello-world-2024");
  });

  it("extracts plain text from headings with inline marks", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "World", marks: [{ type: "bold" }] },
          ],
        },
      ],
    };
    const items = extractTocItems(doc);
    expect(items[0].text).toBe("Hello World");
    expect(items[0].id).toBe("h-hello-world");
  });

  it("uses 'section' fallback for empty heading text", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [],
        },
      ],
    };
    const items = extractTocItems(doc);
    expect(items[0].id).toBe("h-section");
  });
});
