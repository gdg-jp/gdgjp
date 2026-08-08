import { describe, expect, it, vi } from "vitest";
import type { GoogleDocsDocument } from "../../../app/lib/google-drive.server";

const getGoogleDocumentWithTabs = vi.fn();

vi.mock("../../../app/lib/google-drive.server", () => ({
  getGoogleDocumentWithTabs: (...args: unknown[]) => getGoogleDocumentWithTabs(...args),
  exportFileAsText: vi.fn(),
  getDriveFileName: vi.fn(),
  extractFileId: (url: string) => url.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? "",
}));

import { fetchGoogleDocSource } from "./google-doc";

const DOC_URL = "https://docs.google.com/document/d/doc123/edit";

function paragraph(text: string, namedStyleType?: string) {
  return {
    paragraph: {
      ...(namedStyleType ? { paragraphStyle: { namedStyleType } } : {}),
      elements: [{ textRun: { content: `${text}\n` } }],
    },
  };
}

describe("fetchGoogleDocSource", () => {
  it("captures real Markdown structure, not flattened text runs", async () => {
    const document: GoogleDocsDocument = {
      documentId: "doc123",
      title: "I/O Extended Osaka",
      body: {
        content: [paragraph("会場メモ", "HEADING_1"), paragraph("梅田で開催した。")],
      },
    };
    getGoogleDocumentWithTabs.mockResolvedValue(document);

    const result = await fetchGoogleDocSource(DOC_URL, async () => "token-1");

    expect(result.title).toBe("I/O Extended Osaka");
    expect(result.accessToken).toBe("token-1");
    expect(result.documents).toHaveLength(1);
    // The /google-docs workspace adapter would return "会場メモ梅田で開催した。" here.
    expect(result.documents[0]?.path).toBe("index");
    expect(result.documents[0]?.markdown).toContain("# 会場メモ");
  });

  it("maps each tab to its own document keyed by the tab hierarchy", async () => {
    getGoogleDocumentWithTabs.mockResolvedValue({
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

    const result = await fetchGoogleDocSource(DOC_URL, async () => "token-1");

    // The document title stays out of the path so renaming the Doc keeps paths stable,
    // and duplicate sibling titles are disambiguated to protect (source_id, path).
    expect(result.documents.map((doc) => doc.path)).toEqual([
      "議事録",
      "議事録/第 1 回",
      "議事録 (2)",
    ]);
  });

  it("surfaces inline images per tab so they can be stored as assets", async () => {
    getGoogleDocumentWithTabs.mockResolvedValue({
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

    const result = await fetchGoogleDocSource(DOC_URL, async () => "token-1");

    expect(result.documents[0]?.markdown).toContain("attachment:plan");
    expect(result.documents[0]?.images).toEqual([
      expect.objectContaining({ objectId: "plan", sourceUrl: "https://docs.example/plan.png" }),
    ]);
  });
});
