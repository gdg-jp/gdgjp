import { describe, expect, it } from "vitest";
import { convertGoogleDocsDocument } from "./google-docs-markdown.server";
import type { GoogleDocsDocument } from "./google-drive.server";

describe("convertGoogleDocsDocument", () => {
  it("converts headings, marked text, links, nested lists, tables, and inline images", () => {
    const document: GoogleDocsDocument = {
      documentId: "doc-1",
      title: "Import source",
      lists: {
        numbered: {
          listProperties: { nestingLevels: [{ glyphType: "DECIMAL" }, { glyphType: "DECIMAL" }] },
        },
      },
      inlineObjects: {
        hero: {
          inlineObjectProperties: {
            embeddedObject: {
              title: "Hero",
              description: "A hero image",
              imageProperties: {
                contentUri: "https://docs.example/image",
                contentType: "image/png",
              },
            },
          },
        },
      },
      body: {
        content: [
          {
            paragraph: {
              paragraphStyle: { namedStyleType: "HEADING_2" },
              elements: [{ textRun: { content: "Overview\n" } }],
            },
          },
          {
            paragraph: {
              elements: [
                { textRun: { content: "Bold", textStyle: { bold: true } } },
                {
                  textRun: {
                    content: " link",
                    textStyle: { link: { url: "https://example.com" } },
                  },
                },
              ],
            },
          },
          {
            paragraph: {
              bullet: { listId: "numbered", nestingLevel: 1 },
              elements: [{ textRun: { content: "Nested\n" } }],
            },
          },
          { paragraph: { elements: [{ inlineObjectElement: { inlineObjectId: "hero" } }] } },
          {
            table: {
              tableRows: [
                {
                  tableCells: [
                    { content: [{ paragraph: { elements: [{ textRun: { content: "A\n" } }] } }] },
                    { content: [{ paragraph: { elements: [{ textRun: { content: "B\n" } }] } }] },
                  ],
                },
                {
                  tableCells: [
                    { content: [{ paragraph: { elements: [{ textRun: { content: "1\n" } }] } }] },
                    { content: [{ paragraph: { elements: [{ textRun: { content: "2\n" } }] } }] },
                  ],
                },
              ],
            },
          },
        ],
      },
    };
    const node = convertGoogleDocsDocument(document);
    expect(node.markdown).toContain("## Overview");
    expect(node.markdown).toContain("**Bold**[ link](https://example.com)");
    expect(node.markdown).toContain("  1. Nested");
    expect(node.markdown).toContain("![A hero image](attachment:hero)");
    expect(node.markdown).toContain("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(node.images).toEqual([
      {
        objectId: "hero",
        sourceUrl: "https://docs.example/image",
        contentType: "image/png",
        altText: "A hero image",
      },
    ]);
  });

  it("keeps a tab tree separate from an empty document root", () => {
    const node = convertGoogleDocsDocument({
      documentId: "doc-1",
      title: "Tabbed",
      tabs: [
        {
          tabProperties: { tabId: "top", title: "Top" },
          documentTab: {
            body: { content: [{ paragraph: { elements: [{ textRun: { content: "top\n" } }] } }] },
          },
          childTabs: [
            {
              tabProperties: { tabId: "sub", title: "Sub" },
              documentTab: {
                body: {
                  content: [{ paragraph: { elements: [{ textRun: { content: "sub\n" } }] } }],
                },
              },
            },
          ],
        },
      ],
    });
    expect(node.markdown).toBe("");
    expect(node.children[0]).toMatchObject({ externalId: "top", title: "Top", markdown: "top" });
    expect(node.children[0].children[0]).toMatchObject({
      externalId: "sub",
      title: "Sub",
      markdown: "sub",
    });
  });

  it("reads inline images from an individual tab rather than the document root", () => {
    const node = convertGoogleDocsDocument({
      documentId: "doc-1",
      tabs: [
        {
          tabProperties: { tabId: "tab-1", title: "Tab" },
          documentTab: {
            inlineObjects: {
              image: {
                inlineObjectProperties: {
                  embeddedObject: {
                    imageProperties: { contentUri: "https://docs.example/tab.png" },
                  },
                },
              },
            },
            body: {
              content: [
                { paragraph: { elements: [{ inlineObjectElement: { inlineObjectId: "image" } }] } },
              ],
            },
          },
        },
      ],
    });
    expect(node.children[0].markdown).toBe("![](attachment:image)");
    expect(node.children[0].images[0]?.sourceUrl).toBe("https://docs.example/tab.png");
  });
});
