import { describe, expect, it } from "vitest";
import {
  convertGoogleDocsDocument,
  resolveGoogleDocsInternalLinks,
} from "./google-docs-markdown.server";
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

  it("converts date, Calendar, and people smart chips instead of dropping them", () => {
    const node = convertGoogleDocsDocument({
      documentId: "doc-1",
      body: {
        content: [
          {
            paragraph: {
              paragraphStyle: { namedStyleType: "HEADING_2" },
              elements: [
                {
                  dateElement: {
                    dateElementProperties: { displayText: "2026年7月28日" },
                  },
                },
                { textRun: { content: " |" } },
                {
                  richLink: {
                    textStyle: { bold: true, link: { url: "https://ignored.example" } },
                    richLinkProperties: {
                      title: "[ Innovative crosstalk Jamboree・Geeks’26]Weekly",
                      uri: "https://www.google.com/calendar/event?eid=event-id",
                    },
                  },
                },
              ],
            },
          },
          {
            paragraph: {
              elements: [
                { textRun: { content: "参加者: " } },
                {
                  person: {
                    personProperties: { name: "コダック", email: "koduck@example.com" },
                  },
                },
                { textRun: { content: " " } },
                {
                  person: {
                    personProperties: { name: "藤田彩翔", email: "fujita@example.com" },
                  },
                },
              ],
            },
          },
        ],
      },
    });

    expect(
      node.markdown,
    ).toBe(`## 2026年7月28日 |[**\\[ Innovative crosstalk Jamboree・Geeks’26\\]Weekly**](https://www.google.com/calendar/event?eid=event-id)

参加者: [コダック](mailto:koduck@example.com) [藤田彩翔](mailto:fujita@example.com)`);
  });

  it("preserves Docs-only paragraph elements, peripheral content, positioned images, and styles", () => {
    const node = convertGoogleDocsDocument({
      documentId: "doc-1",
      body: {
        content: [
          { sectionBreak: { sectionStyle: { sectionType: "NEXT_PAGE", pageNumberStart: 4 } } },
          {
            paragraph: {
              positionedObjectIds: ["floating"],
              paragraphStyle: {
                headingId: "heading-1",
                namedStyleType: "HEADING_2",
                alignment: "CENTER",
                pageBreakBefore: true,
              },
              elements: [
                {
                  textRun: {
                    content: "Styled\\n",
                    textStyle: {
                      smallCaps: true,
                      baselineOffset: "SUPERSCRIPT",
                      foregroundColor: { color: { rgbColor: { red: 1, green: -1, blue: 0.5 } } },
                      weightedFontFamily: { fontFamily: "Noto Sans JP", weight: 700 },
                    },
                  },
                },
                { autoText: { type: "PAGE_NUMBER" } },
                { pageBreak: {} },
                { columnBreak: {} },
                { horizontalRule: {} },
                { footnoteReference: { footnoteId: "note-1", footnoteNumber: "1" } },
                { equation: {} },
              ],
            },
          },
        ],
      },
      footnotes: {
        "note-1": {
          content: [{ paragraph: { elements: [{ textRun: { content: "Footnote\\n" } }] } }],
        },
      },
      headers: {
        header: { content: [{ paragraph: { elements: [{ textRun: { content: "Header\\n" } }] } }] },
      },
      footers: {
        footer: { content: [{ paragraph: { elements: [{ textRun: { content: "Footer\\n" } }] } }] },
      },
      positionedObjects: {
        floating: {
          positionedObjectProperties: {
            embeddedObject: {
              title: "Floating image",
              imageProperties: {
                contentUri: "https://docs.example/floating.png",
                contentType: "image/png",
              },
            },
          },
        },
      },
    });

    expect(node.markdown).toContain("Google Docs section: NEXT\\_PAGE, page 4");
    expect(node.markdown).toContain('<a id="heading-1"></a>##');
    expect(node.markdown).toContain("font-variant:small-caps");
    expect(node.markdown).toContain("rgb(255, 0, 128)");
    expect(node.markdown).toContain("<sup>");
    expect(node.markdown).toContain("{{PAGE_NUMBER}}");
    expect(node.markdown).toContain("google-docs:page-break");
    expect(node.markdown).toContain("google-docs:column-break");
    expect(node.markdown).toContain("[^note-1]");
    expect(node.markdown).toContain("`N/A`");
    expect(node.markdown).toContain("[^note-1]: Footnote");
    expect(node.markdown).toContain("Google Docs header (header):** Header");
    expect(node.markdown).toContain("Google Docs footer (footer):** Footer");
    expect(node.markdown).toContain("attachment:floating");
    expect(node.images).toHaveLength(1);
    expect(node.warnings).toContain("equation_content_unavailable");
  });

  it("resolves tab and heading links, retaining source fallback for API-unresolvable bookmarks", () => {
    const slugs = new Map([["tab-a", "alpha"]]);
    const result = resolveGoogleDocsInternalLinks(
      "[tab](google-docs://tab/tab-a) [heading](google-docs://heading/tab-a/h-1) [bookmark](google-docs://bookmark/tab-a/b-1)",
      slugs,
      "doc-1",
    );
    expect(result.markdown).toBe(
      "[tab](/wiki/alpha) [heading](/wiki/alpha#h-1) [bookmark](https://docs.google.com/document/d/doc-1/edit)",
    );
    expect(result).toMatchObject({ unresolvedBookmarks: 1, unresolvedTargets: 0 });
  });

  it("does not emit unsafe URLs or CSS values from the source document", () => {
    const node = convertGoogleDocsDocument({
      documentId: "doc-1",
      body: {
        content: [
          {
            paragraph: {
              elements: [
                {
                  textRun: {
                    content: "unsafe",
                    textStyle: {
                      link: { url: "javascript:alert(1)" },
                      weightedFontFamily: {
                        fontFamily: "x; background:url(javascript:1)",
                        weight: 950,
                      },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    });
    expect(node.markdown).toBe("unsafe");
    expect(node.markdown).not.toContain("javascript:");
    expect(node.markdown).not.toContain("font-family");
  });
});
