import { describe, expect, it } from "vitest";
import { createCollectingEventSink } from "../../workers/features/ingestion/orchestration/ports/tool-event-sink";
import { prepareSources } from "../../workers/features/ingestion/tools/source-preprocessor";

describe("prepareSources", () => {
  it("keeps source content out of realtime events", async () => {
    const events: Array<{ type: string; summary?: string }> = [];
    const persisted: Array<{ path: string; content?: string }> = [];
    const prepared = await prepareSources(
      {
        texts: ["Input with https://example.test/private"],
        imageKeys: [],
        googleDocUrls: ["https://docs.google.test/document/d/a"],
      },
      {
        attachmentExists: async () => null,
        exportGoogleDocument: async () => ({
          title: "Private doc",
          nodes: [
            {
              path: "Private doc",
              parentPath: null,
              title: "Private doc",
              kind: "google_document",
              content: "secret body",
              externalId: "a",
            },
          ],
        }),
        exportGoogleForm: async () => ({ title: "unused", text: "unused" }),
        extractUrls: () => [],
        fetchWebPage: async () => ({ markdown: "unused" }),
        persistWorkspaceNodes: async (nodes) => {
          persisted.push(...nodes);
        },
        eventSink: createCollectingEventSink(events as never),
      },
    );

    expect(prepared.userInput).toBe("Input with https://example.test/private");
    expect(prepared.userInput).not.toContain("secret body");
    expect(persisted).toEqual([
      expect.objectContaining({ path: "/google-docs/Private doc", content: "secret body" }),
    ]);
    expect(events).toEqual([
      expect.objectContaining({ type: "tool_started", summary: "Reading a Google document" }),
      expect.objectContaining({ type: "tool_completed" }),
    ]);
    expect(JSON.stringify(events)).not.toContain("secret body");
    expect(JSON.stringify(events)).not.toContain("google.test");
  });
});
