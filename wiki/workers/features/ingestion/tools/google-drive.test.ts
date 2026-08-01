import { afterEach, describe, expect, it, vi } from "vitest";
import { createGoogleDriveTool } from "./google-drive";

describe("Google Drive ingestion tool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exports a Google Slide deck as text instead of sending its ID to the Docs API", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("fields=name")) return Response.json({ name: "Event deck" });
      if (url.includes("/export?")) return new Response("Slide one\nSlide two");
      throw new Error(`Unexpected Google API request: ${url}`);
    });
    vi.stubGlobal("fetch", fetch);

    const source = await createGoogleDriveTool({
      getAccessToken: async () => "token",
    }).exportDocument("https://docs.google.com/presentation/d/slide-id/edit");

    expect(source).toEqual({
      title: "Event deck",
      nodes: [
        {
          path: "Event deck",
          parentPath: null,
          title: "Event deck",
          kind: "google_document",
          content: "Slide one\nSlide two",
          externalId: "slide-id",
        },
      ],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[1][0])).toContain("/drive/v3/files/slide-id/export");
    expect(String(fetch.mock.calls[1][0])).toContain("mimeType=text%2Fplain");
    expect(String(fetch.mock.calls[1][0])).not.toContain("docs.googleapis.com");
  });

  it("uses the Docs API only for Google Docs URLs", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("docs.googleapis.com")) {
        return Response.json({
          documentId: "doc-id",
          title: "Meeting notes",
          body: { content: [] },
        });
      }
      throw new Error(`Unexpected Google API request: ${url}`);
    });
    vi.stubGlobal("fetch", fetch);

    const source = await createGoogleDriveTool({
      getAccessToken: async () => "token",
    }).exportDocument("https://docs.google.com/document/d/doc-id/edit");

    expect(source.title).toBe("Meeting notes");
    expect(String(fetch.mock.calls[0][0])).toContain("docs.googleapis.com/v1/documents/doc-id");
  });
});
