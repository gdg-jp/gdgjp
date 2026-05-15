import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TipTapRenderer } from "~/components/TipTapRenderer";
import type { TipTapDoc } from "~/components/TipTapRenderer";

function render(doc: TipTapDoc): string {
  return renderToString(<TipTapRenderer doc={doc} />);
}

describe("TipTapRenderer golden snapshots", () => {
  it("rich article: headings, bold inline, bullet list, code block", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Getting Started" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Welcome to the " },
            { type: "text", text: "wiki", marks: [{ type: "bold" }] },
            { type: "text", text: "." },
          ],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Installation" }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Clone the repo" }] }],
            },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Run pnpm install" }] },
              ],
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { language: "bash" },
          content: [{ type: "text", text: "pnpm dev" }],
        },
      ],
    };
    expect(render(doc)).toMatchSnapshot();
  });

  it("inline marks: bold, italic, strike, code, link in one paragraph", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: " " },
            { type: "text", text: "italic", marks: [{ type: "italic" }] },
            { type: "text", text: " " },
            { type: "text", text: "strike", marks: [{ type: "strike" }] },
            { type: "text", text: " " },
            { type: "text", text: "code", marks: [{ type: "code" }] },
            { type: "text", text: " " },
            {
              type: "text",
              text: "link",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
      ],
    };
    expect(render(doc)).toMatchSnapshot();
  });

  it("table: header row and data row", () => {
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
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Name" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Role" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Alice" }],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Lead" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(render(doc)).toMatchSnapshot();
  });

  it("deduplicated headings: same text twice pins the -1 suffix logic", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Overview" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "First overview section." }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Overview" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Second overview section." }],
        },
      ],
    };
    expect(render(doc)).toMatchSnapshot();
  });
});
