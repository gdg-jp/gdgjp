import { describe, expect, it } from "vitest";
import {
  type SectionPatch,
  type TipTapDoc,
  applyPatchesToMarkdown,
  tiptapToMarkdown,
} from "~/lib/tiptap-convert";

describe("tiptapToMarkdown golden snapshots", () => {
  it("full-featured doc: h1, mixed inline marks, bullet list, code block, table, blockquote, hr", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Project Overview" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "This is " },
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: ", " },
            { type: "text", text: "italic", marks: [{ type: "italic" }] },
            { type: "text", text: ", " },
            { type: "text", text: "struck", marks: [{ type: "strike" }] },
            { type: "text", text: ", " },
            { type: "text", text: "code", marks: [{ type: "code" }] },
            { type: "text", text: ", and " },
            {
              type: "text",
              text: "a link",
              marks: [{ type: "link", attrs: { href: "https://gdg.community.dev" } }],
            },
            { type: "text", text: "." },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Feature A" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Feature B" }] }],
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { language: "typescript" },
          content: [{ type: "text", text: "const x: number = 42" }],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Key" }] }],
                },
                {
                  type: "tableHeader",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Value" }] }],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "name" }] }],
                },
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "gdg-wiki" }] }],
                },
              ],
            },
          ],
        },
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Build for the community." }],
            },
          ],
        },
        { type: "horizontalRule" },
      ],
    };
    expect(tiptapToMarkdown(doc)).toMatchSnapshot();
  });

  it("nested lists: ordered list inside bullet list item pins indentation format", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Top-level bullet" }] },
                {
                  type: "orderedList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "Nested step one" }],
                        },
                      ],
                    },
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "Nested step two" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Second bullet" }] }],
            },
          ],
        },
      ],
    };
    expect(tiptapToMarkdown(doc)).toMatchSnapshot();
  });
});

describe("applyPatchesToMarkdown golden snapshots", () => {
  it("patch application: existing sections + append + auto-created section", () => {
    const existing = `# My Page

## Introduction

Some intro text.

## Details

More details here.`;

    const patches: SectionPatch[] = [
      {
        headingMatch: "Introduction",
        operation: "append",
        content: "Additional intro content appended.",
      },
      {
        headingMatch: "Nonexistent Section",
        operation: "append",
        newHeading: "Nonexistent Section",
        content: "Auto-created because heading was not found.",
      },
      {
        headingMatch: null,
        operation: "append",
        content: "Document-level append at the end.",
      },
    ];

    expect(applyPatchesToMarkdown(existing, patches)).toMatchSnapshot();
  });
});
