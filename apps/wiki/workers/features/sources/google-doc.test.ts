import { describe, expect, it } from "vitest";
import { convertGoogleDocsDocument } from "../../../app/features/google/docs-markdown.server";
import type { GoogleDocsDocument } from "../../../app/features/google/drive.server";
import { collectDocuments } from "./google-doc";

function documents(document: GoogleDocsDocument) {
  return collectDocuments(convertGoogleDocsDocument(document));
}

function paragraph(text: string, namedStyleType?: string) {
  return {
    paragraph: {
      ...(namedStyleType ? { paragraphStyle: { namedStyleType } } : {}),
      elements: [{ textRun: { content: `${text}\n` } }],
    },
  };
}

describe("collectDocuments", () => {
  it("captures real Markdown structure, not flattened text runs", () => {
    const document: GoogleDocsDocument = {
      documentId: "doc123",
      title: "I/O Extended Osaka",
      body: {
        content: [paragraph("会場メモ", "HEADING_1"), paragraph("梅田で開催した。")],
      },
    };
    const result = documents(document);

    expect(result).toHaveLength(1);
    // The /google-docs workspace adapter would return "会場メモ梅田で開催した。" here.
    expect(result[0]?.path).toBe("index");
    expect(result[0]?.markdown).toContain("# 会場メモ");
  });

  it("maps each tab to its own document keyed by the tab hierarchy", () => {
    const result = documents({
      documentId: "doc123",
      title: "Event",
      tabs: [
        {
          tabProperties: { tabId: "t1", title: "議事録" },
          documentTab: { body: { content: [paragraph("kickoff")] } },
          childTabs: [
            {
              tabProperties: { tabId: "t1-1", title: "第 1 回" },
              documentTab: { body: { content: [paragraph("detail")] } },
            },
          ],
        },
        {
          tabProperties: { tabId: "t2", title: "議事録" },
          documentTab: { body: { content: [paragraph("dup")] } },
        },
      ],
    } as GoogleDocsDocument);

    // The document title stays out of the path so renaming the Doc keeps paths stable,
    // and duplicate sibling titles are disambiguated to protect (source_id, path).
    expect(result.map((doc) => doc.path)).toEqual(["議事録", "議事録/第 1 回", "議事録 (2)"]);
  });

  it("surfaces inline images per tab so they can be stored as assets", () => {
    const result = documents({
      documentId: "doc123",
      title: "Event",
      tabs: [
        {
          tabProperties: { tabId: "t1", title: "Venue" },
          documentTab: {
            inlineObjects: {
              plan: {
                inlineObjectProperties: {
                  embeddedObject: {
                    imageProperties: { contentUri: "https://docs.example/plan.png" },
                  },
                },
              },
            },
            body: {
              content: [
                { paragraph: { elements: [{ inlineObjectElement: { inlineObjectId: "plan" } }] } },
              ],
            },
          },
        },
      ],
    } as GoogleDocsDocument);

    expect(result[0]?.markdown).toContain("attachment:plan");
    expect(result[0]?.images).toEqual([
      expect.objectContaining({ objectId: "plan", sourceUrl: "https://docs.example/plan.png" }),
    ]);
  });
});
