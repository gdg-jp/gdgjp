import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TipTapRenderer } from "~/components/TipTapRenderer";
import type { TipTapDoc } from "~/components/TipTapRenderer";

function render(doc: TipTapDoc): string {
  return renderToString(<TipTapRenderer doc={doc} />);
}

describe("TipTapRenderer", () => {
  it("renders a paragraph", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
    };
    const html = render(doc);
    expect(html).toContain("<p");
    expect(html).toContain("Hello world");
  });

  it("renders h2 with auto-generated id", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "My Section" }] },
      ],
    };
    const html = render(doc);
    expect(html).toContain("<h2");
    expect(html).toContain('id="h-my-section"');
    expect(html).toContain("My Section");
  });

  it("renders h3 nested under h2 with correct IDs", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "A" }] },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "B" }] },
      ],
    };
    const html = render(doc);
    expect(html).toContain('id="h-a"');
    expect(html).toContain('id="h-b"');
  });

  it("renders bold text with <strong>", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "bold", marks: [{ type: "bold" }] }],
        },
      ],
    };
    const html = render(doc);
    expect(html).toContain("<strong>bold</strong>");
  });

  it("renders italic text with <em>", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "italic", marks: [{ type: "italic" }] }],
        },
      ],
    };
    const html = render(doc);
    expect(html).toContain("<em>italic</em>");
  });

  it("renders strikethrough with <s>", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "gone", marks: [{ type: "strike" }] }],
        },
      ],
    };
    const html = render(doc);
    expect(html).toContain("<s>gone</s>");
  });

  it("renders inline code with <code>", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "foo", marks: [{ type: "code" }] }],
        },
      ],
    };
    const html = render(doc);
    expect(html).toContain("<code");
    expect(html).toContain("foo");
  });

  it("renders a link with href", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "click",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
      ],
    };
    const html = render(doc);
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("click");
  });

  it("renders a bullet list", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Item A" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Item B" }] }],
            },
          ],
        },
      ],
    };
    const html = render(doc);
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    expect(html).toContain("Item A");
    expect(html).toContain("Item B");
  });

  it("renders an ordered list", () => {
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
          ],
        },
      ],
    };
    const html = render(doc);
    expect(html).toContain("<ol");
  });

  it("renders a code block with language class", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "typescript" },
          content: [{ type: "text", text: "const x = 1" }],
        },
      ],
    };
    const html = render(doc);
    expect(html).toContain("<pre");
    expect(html).toContain("<code");
    expect(html).toContain("const x = 1");
    expect(html).toContain("language-typescript");
  });

  it("renders a blockquote", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "quote" }] }],
        },
      ],
    };
    const html = render(doc);
    expect(html).toContain("<blockquote");
    expect(html).toContain("quote");
  });

  it("renders a horizontal rule", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [{ type: "horizontalRule" }],
    };
    const html = render(doc);
    expect(html).toContain("<hr");
  });

  it("renders an image", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [{ type: "image", attrs: { src: "https://example.com/img.png", alt: "A picture" } }],
    };
    const html = render(doc);
    expect(html).toContain("<img");
    expect(html).toContain('src="https://example.com/img.png"');
    expect(html).toContain('alt="A picture"');
  });

  it("renders a table with th and td", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Name" }] }],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Alice" }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const html = render(doc);
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("<td");
    expect(html).toContain("Name");
    expect(html).toContain("Alice");
  });

  it("renders empty doc as wrapper div", () => {
    const doc: TipTapDoc = { type: "doc", content: [] };
    const html = render(doc);
    expect(html).toContain("<div");
  });
});
