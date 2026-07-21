import { describe, expect, it } from "vitest";
import type { IngestionRealtimeEvent } from "../../shared/ingestion/realtime-events";
import { createCollectingEventSink } from "../../workers/features/ingestion/orchestration/ports/tool-event-sink";
import { prepareSources } from "../../workers/features/ingestion/tools/source-preprocessor";

describe("prepareSources", () => {
  it("keeps source content out of realtime events", async () => {
    const events: IngestionRealtimeEvent[] = [];
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
        eventSink: createCollectingEventSink(events),
      },
    );

    expect(prepared.userInput).toBe("Input with https://example.test/private");
    expect(prepared.userInput).not.toContain("secret body");
    expect(persisted).toEqual([
      expect.objectContaining({ path: "/google-docs/Private doc", content: "secret body" }),
    ]);
    expect(events).toEqual([
      expect.objectContaining({
        type: "tool_started",
        args: { url: "https://docs.google.test/document/d/a" },
        summary: "Reading a Google document",
      }),
      expect.objectContaining({
        type: "tool_completed",
        args: { url: "https://docs.google.test/document/d/a" },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("secret body");
  });

  it("keeps source arguments but not failure details in failed tool events", async () => {
    const events: IngestionRealtimeEvent[] = [];
    const sourceUrl = "https://docs.google.test/document/d/private";

    await expect(
      prepareSources(
        {
          texts: [],
          imageKeys: [],
          googleDocUrls: [sourceUrl],
        },
        {
          attachmentExists: async () => null,
          exportGoogleDocument: async () => {
            throw new Error("secret provider response");
          },
          exportGoogleForm: async () => ({ title: "unused", text: "unused" }),
          extractUrls: () => [],
          fetchWebPage: async () => ({ markdown: "unused" }),
          persistWorkspaceNodes: async () => undefined,
          eventSink: createCollectingEventSink(events),
        },
      ),
    ).rejects.toThrow("secret provider response");

    expect(events).toEqual([
      expect.objectContaining({ type: "tool_started", args: { url: sourceUrl } }),
      expect.objectContaining({
        type: "tool_failed",
        args: { url: sourceUrl },
        errorCode: "source_tool_failed",
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("secret provider response");
  });
});
